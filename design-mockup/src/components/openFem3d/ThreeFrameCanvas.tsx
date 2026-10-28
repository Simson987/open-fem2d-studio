import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addOpenFem3DPlate, addOpenFem3DPlateOpening, openFem3DLoadCaseId, setOpenFem3DBeamEndHinge, splitOpenFem3DBeam, type OpenFem3DModel, type OpenFem3DPlateBoundarySegment } from "./openFem3dModel";
import { addOpenFem3DLoadPanel, openFem3DLoadPanelGeometry } from "./openFem3dLoadPanels";
import { addOpenFem3DLoadPanelMarkers, openFem3DLoadSurfaceObjects } from "./openFem3dLoadPanelVisuals";
import { openFem3DLoadPanelSurface } from "./openFem3dLoadSurfaces";
import { addOpenFem3DEnvelopePanel, openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import {
  openFem3DLoadCaseColor,
  openFem3DPickThroughDepth,
  openFem3DSolidIntersections,
  openFem3DSurfaceLoadSurface,
} from "./openFem3dLoadSurfaces";
import type { OpenFem3DVisibility } from "./openFem3dVisibility";
import type { OpenFem3DView } from "./openFem3dCommands";
import {
  addOpenFem3DBeamHingeMarkers, addOpenFem3DConditionMarkers, openFem3DBeamHingePlacements, openFem3DConditionMarkerSize,
  openFem3DLoadPickSegments, type OpenFem3DBeamHingePlacement,
} from "./openFem3dMarkers";
import type { StructuralGrid } from "../fem/femTypes";
import type {
  OpenFem3DDiagramPoint,
  OpenFem3DDiagrams,
  OpenFem3DMemberDiagram,
  OpenFem3DMemberForces,
  OpenFem3DSolveResult,
} from "./openFem3dSolver";
import type { OpenFem3DTool } from "./openFem3dCommands";
import {
  OPEN_FEM_3D_UTILIZATION_COLORS,
  openFem3DUtilizationClass,
  type OpenFem3DUtilization,
} from "./openFem3dUtilization";
import {
  createOpenFem3DBeamProfileGeometry, openFem3DBeamProfileExtent, openFem3DBeamProfileKey, openFem3DBeamSweepSections,
  openFem3DProfileInstanceScale,
} from "./openFem3dProfileGeometry";
import { openFem3DProfielTekst } from "./openFem3dVerloop";
import { openFem3DMaximumDisplacement, openFem3DMemberDisplacementStations } from "./openFem3dDisplacement";
import {
  DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY,
  openFem3DAutoDeformationScale,
  openFem3DDeformationScale,
  type OpenFem3DDeformationDisplay,
} from "./openFem3dDeformationDisplay";
import {
  DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS,
  OPEN_FEM_3D_FORCE_LAYERS,
  OPEN_FEM_3D_MID_FORCES,
  openFem3DDiagramDrawn,
  openFem3DDiagramLabelSelection,
  openFem3DDiagramValueAt,
  openFem3DResultLabelStride,
  planOpenFem3DDiagramLabels,
  sameOpenFem3DDiagramLabels,
  type OpenFem3DDiagramLabelBeam,
  type OpenFem3DDiagramLabels,
} from "./openFem3dDiagramLabels";
import { placeOpenFem3DLabels, type OpenFem3DLabelCandidate, type OpenFem3DLabelRect } from "./openFem3dLabelLayout";
import {
  openFem3DSelectionContains,
  toggleOpenFem3DSelection,
  type OpenFem3DSelection, type OpenFem3DSelectionType, type OpenFem3DSingleSelection,
} from "./openFem3dSelection";
import { openFem3DViewFromCamera, type OpenFem3DCameraState } from "./openFem3dViewSets";
import {
  OPEN_FEM_3D_FOV_GRADEN,
  isOpenFem3DOrtho,
  openFem3DCameraAfstand,
  openFem3DOrthoAfstand,
  openFem3DOrthoHalveHoogte,
  openFem3DOrthoHalveHoogteVan,
  openFem3DOrthoPassendeHalveHoogte,
  openFem3DOrthoWielStap,
  openFem3DPerspectiefAfstand,
  openFem3DStraalOpVlak,
  openFem3DWereldmaatPerPixel,
  openFem3DZetOrthoFrustum,
  type OpenFem3DCamera,
} from "./openFem3dProjectie";
import {
  openFem3DAanzichtRichting,
  openFem3DStartCamera,
  openFem3DViewCubeDraai,
  openFem3DViewCubeMatrix,
  openFem3DViewCubeSleepHoeken,
  openFem3DViewCubeUp,
  type Vec3,
} from "./openFem3dViewCube";
import {
  createOpenFem3DViewCube,
  type OpenFem3DViewCubeDom,
  type OpenFem3DViewCubeMenuItem,
  type OpenFem3DViewCubeTeksten,
} from "./openFem3dViewCubeDom";
import { openFem3DWorkPlaneOrigin } from "./openFem3dWorkPlane";
import { createOpenFem3DPlateGeometry, type OpenFem3DPlateGeometry } from "./openFem3dPlateGeometry";
import {
  OPEN_FEM_3D_PLATE_DISPLAY_STYLES, type OpenFem3DPlateDisplay, type OpenFem3DPlateDisplayStyle,
} from "./openFem3dPlateDisplay";
import {
  buildOpenFem3DPlateEdgeSupports, buildOpenFem3DPlateOverlay, OPEN_FEM_3D_PLATE_EDGE_SUPPORTS_NAME,
} from "./openFem3dPlateOverlay";
import { buildOpenFem3DPlateBeddingHatch, OPEN_FEM_3D_PLATE_BEDDING_NAME } from "./openFem3dPlateBeddingHatch";
import { openFem3DScaledSymbolSize, openFem3DSymbolScaleFactor } from "./openFem3dSymbolScale";
import type { OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import type { OpenFem3DPlateQuantity } from "./openFem3dPlateResults";
import { sampleCircularArc3D } from "./openFem3dCircularArc";
import { selectOpenFem3DInScreenBox } from "./openFem3dBoxSelection";
import { findOpenFem3DBeamNearScreenPoint, findOpenFem3DSegmentNearScreenPoint } from "./openFem3dBeamScreenPick";
import { chooseOpenFem3DPick, chooseOpenFem3DPlacement, type OpenFem3DLoadSelectionType, type OpenFem3DNodeRayHit } from "./openFem3dPick";
import { openFem3DOrbitPivotShift, openFem3DSelectionPivot } from "./openFem3dOrbitPivot";
import { openFem3DNodeConditionOfTool, type OpenFem3DNodeTarget } from "./openFem3dNodeTools";
import { openFem3DPlacementNodeOwners, projectOpenFem3DPointOnPlate, type OpenFem3DPointLoadTarget } from "./openFem3dPlaatsen";
import { createOpenFem3DSweptProfilesGeometry, type OpenFem3DSweepInput } from "./openFem3dDeformedSweep";
import type { OpenFem3DEditMeta } from "./openFem3dHistory";
import { useSnapInstellingen, type SnapInstellingen, type SnapSoort } from "../../hooks/useSnapInstellingen";
import {
  kiesTekenpunt, leesMaat, maatEindpunt, maatTekst, maatToets, ratioOpStaaf, staafSplitsing, tekenpuntTekst,
  toonGetypteMaat, uitwijking, verwerf, verworvenNaModel,
  SPOOR_STILSTAND_PX, SPOOR_VERWERF_KNOOP_PX, SPOOR_VERWERF_MS, SPOOR_VERWERF_STAAF_PX,
  type As3, type Punt3, type Tekenpunt, type VerworvenItem, type Werkvlak,
} from "./openFem3dTekenhulp";
import { ORTHO_WISSEL_MIN_PX } from "../../lib/tekenhulp";
import { openFem3DGridLayout } from "./openFem3dGrid";
import {
  OPEN_FEM_3D_PEILMAAT_AFSTAND_PX, OPEN_FEM_3D_PEILMAAT_STREEP_PX, openFem3DLabelStride, openFem3DLevelRechthoeken, openFem3DLevelZichtbaarheid,
  openFem3DPeilmaatBruikbareBreedte, openFem3DPeilmaatHoek, openFem3DPeilmaatRand, openFem3DPeilmaatRuimtePx,
  openFem3DPeilmaatVerschuivingPx, openFem3DPeilmaten, openFem3DStramienKader,
  type OpenFem3DPeilmaat, type OpenFem3DPunt,
} from "./openFem3dPeilmaten";
import { PEIL_DRIEHOEK_HALF_PX, PEIL_DRIEHOEK_HOOGTE_PX } from "../../lib/peilmaat";
import { wheelAnchor } from "./openFem3dWheelAnchor";
import { openFem3DDiagramDirection, type OpenFem3DDiagramComponent } from "./openFem3dDiagramSide";
import { openFem3DBeddingLiftedRuns, openFem3DBeddingPressurePoints } from "./openFem3dBedding";
import { OPEN_FEM_3D_BEDDING_COLOR } from "./openFem3dBeddingBand";
import { kleurGetal, openFem3DProfielKleuring, profielKleurenActief3d } from "../../lib/profielKleur";
import {
  buildOpenFem3DNodeSnapScreenIndex,
  findOpenFem3DNodeAtScreenPoint,
  findOpenFem3DNodeScreenSnap,
  type OpenFem3DNodeSnapScreenIndex,
} from "./openFem3dNodeSnapIndex";
import { openFem3DBeamEndNear, openFem3DNodeNearPoint } from "./openFem3dSamenvoegen";
import { kaderModus } from "../../lib/kaderSelectie";
import { escapeActie, isInvoerVeld, volgDialoogBijToets } from "../../lib/escapeToets";
import { erIsEenDialoogOpen } from "../Modal";
import {
  DEFAULT_OPEN_FEM_3D_SECTION_BOX,
  openFem3DSectionBoxActief,
  openFem3DSectionBoxAsParameter,
  openFem3DSectionBoxBevat,
  openFem3DSectionBoxGelijk,
  openFem3DSectionBoxKnipLijnstuk,
  openFem3DSectionBoxOpSelectie,
  openFem3DSectionBoxReset,
  openFem3DSectionBoxSchakel,
  openFem3DSectionBoxVlakMidden,
  openFem3DSectionBoxVlakWaarde,
  openFem3DSectionBoxZetVlak,
  type OpenFem3DSectionBox,
  type OpenFem3DSectionBoxBounds,
  type OpenFem3DSectionBoxVlak,
} from "./openFem3dSectionBox";
import { openFem3DExplodeSourceNodeId, toggleOpenFem3DExplode } from "./openFem3dExplode";
import {
  createOpenFem3DSectionBoxBeeld, openFem3DSectionBoxKnipMaterialen, openFem3DSectionBoxNietKnippen,
  type OpenFem3DSectionBoxBeeld,
} from "./openFem3dSectionBoxBeeld";
import {
  OPEN_FEM_3D_STRAMIEN_KLEUR, OPEN_FEM_3D_STRAMIEN_LEVEL_KLEUR, maakOpenFem3DStramienLijnen, openFem3DStramienCameraDoel,
} from "./openFem3dStramienLijn";

// De analytische knoop is een punt, maar in de editor moet hij ook op afstand
// goed aanklikbaar en herkenbaar blijven. De staaf loopt tot het middelpunt van
// deze bol en verdwijnt er dus ruim in: ook onder een schuine kijkhoek ontstaat
// er nergens een zichtbare kier tussen staaf en knoop.
const ANALYTICAL_BEAM_RADIUS_M = 0.035;
const PROFILE_BEAM_RADIUS_M = 0.12;
// Eén klik tot zoveel pixels naast de systeemlijn selecteert de staaf, ook een
// dun buisverband of een profiel van één pixel breed.
const BEAM_PICK_RADIUS_PX = 6;
// Idem voor een lastpijl en de staartlijn van een lijnlast: de pijlsteel is
// uitgezoomd dunner dan een pixel.
const LOAD_PICK_RADIUS_PX = 5;
// Een knoop wint alleen als de klik echt op zijn getekende bol valt; een
// kleine bol krijgt minstens deze straal. De vaste 7 px van vroeger ving in
// een uitgezoomd groot model de klik op de staaf tussen twee knopen.
const NODE_PICK_MIN_RADIUS_PX = 4;
// Bij het plaatsen van een oplegging of een tussenknoop gaat het om de knoop
// (of om niet vlak naast een knoop te splitsen): daar blijft de ruimere zone.
const TOOL_NODE_PICK_RADIUS_PX = 7;
// Het zoekgebied om de klik bij 100 % knoopgrootte; het groeit mee met de
// regelaar Knopen (issue #82), zodat ook de rand van een vergrote bol kiest.
const NODE_PICK_MAX_RADIUS_PX = 48;
// Plaatsgereedschappen (oplegging, veer, puntlast; issues #76 en #77): een
// knoop binnen deze snapafstand krijgt de plaatsing, ook als de klik een
// staaf of plaat raakt; dezelfde zone als de knoopsnap bij het tekenen. Een
// vergrote knoopbol (regelaar Knopen) vangt tot zijn getekende rand. Met de
// knoopsnap uit telt alleen de getekende bol (minstens 7 px).
const PLACEMENT_NODE_SNAP_RADIUS_PX = 14;
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

/**
 * Een knoopbol is minstens 2,2 × zo dik als de analytische staaf: dan is hij
 * ook in een klein model een duidelijke bol op de staaf, met ruimte voor het
 * kleinere scharnierbolletje ervoor (#93).
 */
const NODE_MIN_RADIUS_M = 2.2 * ANALYTICAL_BEAM_RADIUS_M;

/** Ongeveer dezelfde 10 px diameter als de 2D-knoop bij passend beeld, maar niet dunner dan {@link NODE_MIN_RADIUS_M}. */
function visualNodeRadius(model: OpenFem3DModel): number {
  if (model.nodes.length < 2) return NODE_MIN_RADIUS_M;
  const box = openFem3DNodeBounds(model);
  return Math.max(NODE_MIN_RADIUS_M, Math.min(0.08, box.getSize(new THREE.Vector3()).length() * 0.006));
}

/**
 * De getekende knoopstraal: de automatische straal × de regelaar Knopen
 * (issue #82, 25–400 %). Ook de kiesstraal en de scharnierbolletjes volgen
 * deze straal; passend beeld rekent met de automatische straal.
 */
function scaledNodeRadius(model: OpenFem3DModel, visibility: Pick<OpenFem3DVisibility, "nodeSizePercent">): number {
  return openFem3DScaledSymbolSize(visualNodeRadius(model), visibility.nodeSizePercent);
}

/** Een scharnierbolletje blijft duidelijk dikker dan de analytische staaf (#93). */
const BEAM_HINGE_MIN_RADIUS_M = ANALYTICAL_BEAM_RADIUS_M * 1.25;

/**
 * Hoe ver het getekende profiel van een staaf hoogstens buiten de staafas
 * uitsteekt: de verste hoek van de doorsnede vanaf het zwaartepunt, of de
 * cilinder van een staaf zonder bekend profiel.
 */
function profileExtentM(beam: OpenFem3DModel["beams"][number]): number {
  // Een verlopende staaf (#73): de grootste van begin- en einddoorsnede.
  const section = openFem3DBeamProfileExtent(beam);
  if (!section) return PROFILE_BEAM_RADIUS_M;
  return Math.hypot(section.widthM / 2 + Math.abs(section.centroid.x) / 1000, section.heightM / 2 + Math.abs(section.centroid.y) / 1000);
}

/** De scharnierbolletjes op staafeinden; zonder zichtbare staven geen. */
function beamHingePlacementsFor(
  model: OpenFem3DModel, visibility: OpenFem3DVisibility, nodeRadius: number,
): OpenFem3DBeamHingePlacement[] {
  if (!visibility.beams) return [];
  return openFem3DBeamHingePlacements(model, {
    nodeRadius, markerSize: openFem3DConditionMarkerSize(model.nodes), minRadius: BEAM_HINGE_MIN_RADIUS_M,
    ...(visibility.profiles ? { profileExtent: profileExtentM } : {}),
  });
}

/** Wat de laag met scharnierbolletjes tekent: gelijk gebleven, dan blijft de laag staan. */
function beamHingeLayerKey(placements: readonly OpenFem3DBeamHingePlacement[]): string {
  return placements.map((item) => `${item.beamId}${item.end[0]}:${item.position.toArray().map((value) => value.toFixed(6)).join(",")}`
    + `:${item.radius.toFixed(6)}:${item.rimRadius.toFixed(6)}:${item.depthBias.toFixed(6)}`).join(";");
}

/**
 * De laag met scharnierbolletjes (#93): een klein licht bolletje met een
 * donkere rand op de staaf, net vóór de knoopbol, bij elk staafeind met een
 * los My, Mz of T. Een klik erop kiest de staaf. In de profielweergave ligt de
 * staafas binnen het profiel; dan komt het bolletje in de dieptebuffer zo ver
 * naar voren als het profiel uitsteekt, zodat een staaf ervoor het nog
 * verbergt.
 */
function buildBeamHingeLayer(placements: readonly OpenFem3DBeamHingePlacement[]): THREE.Group {
  const group = new THREE.Group();
  group.userData.openFem3dBeamHinges = true;
  group.userData.openFem3dBeamHingeKey = beamHingeLayerKey(placements);
  addOpenFem3DBeamHingeMarkers(group, placements);
  return group;
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
      const profile = openFem3DBeamProfileExtent(beam);
      if (profile) padding = Math.max(padding, Math.hypot(profile.widthM, profile.heightM) / 2);
    }
  }
  if (!box.isEmpty()) box.expandByScalar(padding * 1.15);
  return box;
}

/**
 * Halve maten van de begrenzing rond haar midden: op het cameravlak (breedte
 * en hoogte, met `up`) en langs de kijkrichting (diepte). Een omgeschreven
 * bol is bij een lang, laag raamwerk veel te ruim: de straal wordt dan door
 * de lengte bepaald en laat boven en onder onnodig veel leegte. Door alle
 * acht hoeken op het cameravlak te projecteren benut het model de
 * beschikbare breedte én hoogte, ook in isometrisch aanzicht.
 */
function projectedHalfExtents(up: THREE.Vector3, box: THREE.Box3, centerToCamera: THREE.Vector3) {
  const center = box.getCenter(new THREE.Vector3());
  const direction = centerToCamera.clone().normalize();
  const right = new THREE.Vector3().crossVectors(up, direction).normalize();
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
  return { halfWidth, halfHeight, halfDepth };
}

/**
 * Het deel van het beeld (als fractie) dat passend beeld mag vullen. Het
 * canvas bevat bovenaan de titel en de knop Passend beeld, en onderaan
 * statusinformatie. Reserveer hun ruimte ook voor een klein model: de vaste
 * minimumafstand van 2 m alleen liet een plaat net onder de kopregel vallen.
 * Dezelfde marge in perspectief en in parallelle projectie.
 */
function usableViewport(viewportWidthPx: number, viewportHeightPx: number) {
  return {
    breedte: Math.max(0.7, 1 - 48 / Math.max(viewportWidthPx, 1)),
    hoogte: Math.max(0.55, 1 - 88 / Math.max(viewportHeightPx, 1)),
  };
}

/**
 * Het bruikbare deel met links ruimte voor de peilmaten (issue #92): de
 * breedte min hun labelbreedte (`levelMarkSpacePx`); zonder peilmaten gelijk
 * aan usableViewport.
 */
function usableViewportWithLevelMarks(viewportWidthPx: number, viewportHeightPx: number, levelMarkSpacePx: number) {
  const basis = usableViewport(viewportWidthPx, viewportHeightPx);
  return { ...basis, breedte: openFem3DPeilmaatBruikbareBreedte(basis.breedte, viewportWidthPx, levelMarkSpacePx) };
}

/** Benodigde camerafstand (perspectief) voor de geprojecteerde begrenzing van het model. */
function fittedCameraDistance(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  centerToCamera: THREE.Vector3,
  viewportWidthPx: number,
  viewportHeightPx: number,
  levelMarkSpacePx = 0,
): number {
  if (box.isEmpty()) return 4;
  const { halfWidth, halfHeight, halfDepth } = projectedHalfExtents(camera.up, box, centerToCamera);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.05));
  const usable = usableViewportWithLevelMarks(viewportWidthPx, viewportHeightPx, levelMarkSpacePx);
  const projectedDistance = Math.max(
    halfHeight / Math.max(Math.tan(verticalFov / 2) * usable.hoogte, 1e-6),
    halfWidth / Math.max(Math.tan(horizontalFov / 2) * usable.breedte, 1e-6),
  );
  return Math.max(2, (halfDepth + projectedDistance) * 1.08);
}

/**
 * Passend beeld in parallelle projectie: de halve hoogte van het frustum
 * waarbij het model met dezelfde marge past als in perspectief.
 */
function fittedOrthoHalfHeight(
  camera: THREE.OrthographicCamera,
  aspect: number,
  box: THREE.Box3,
  centerToCamera: THREE.Vector3,
  viewportWidthPx: number,
  viewportHeightPx: number,
  levelMarkSpacePx = 0,
): number {
  if (box.isEmpty()) return openFem3DOrthoHalveHoogte(4);
  return openFem3DOrthoPassendeHalveHoogte(
    projectedHalfExtents(camera.up, box, centerToCamera), aspect,
    usableViewportWithLevelMarks(viewportWidthPx, viewportHeightPx, levelMarkSpacePx),
  );
}

/**
 * Zet de parallelle camera op zijn plek: in de huidige kijkrichting, ver
 * genoeg van het doel dat model, raster en assen vóór de camera liggen
 * (openFem3DOrthoAfstand), met ruime near/far. Het beeld verandert er niet
 * door: alleen de diepte. In perspectief doet dit niets.
 */
function plaatsOrthoCamera(state: SceneState) {
  const camera = state.camera;
  if (!isOpenFem3DOrtho(camera)) return;
  const offset = camera.position.clone().sub(state.controls.target);
  const richting = offset.lengthSq() > 1e-18
    ? offset.normalize() : new THREE.Vector3(...openFem3DAanzichtRichting("iso").richting);
  const { afstand, near, far } = openFem3DOrthoAfstand(
    openFem3DOrthoHalveHoogteVan(camera), state.controls.target, state.orthoBol(),
  );
  camera.position.copy(state.controls.target).addScaledVector(richting, afstand);
  if (camera.near !== near || camera.far !== far) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}

/**
 * Wissel tussen perspectief en parallel (zichtbaarheid `perspective`). Doel,
 * kijkrichting en up blijven; de zichtbare grootte bij het doel ook:
 * h = d · tan(fov/2) heen, d = h / tan(fov/2) terug (openFem3dProjectie.ts).
 * Geeft false als de gevraagde camera al actief is.
 */
function zetOpenFem3DProjectie(state: SceneState, perspectief: boolean): boolean {
  const huidig = state.camera;
  const volgende = perspectief ? state.perspectiveCamera : state.orthographicCamera;
  if (huidig === volgende) return false;
  const doel = state.controls.target;
  const offset = huidig.position.clone().sub(doel);
  const richting = offset.lengthSq() > 1e-18
    ? offset.clone().normalize() : new THREE.Vector3(...openFem3DAanzichtRichting("iso").richting);
  volgende.up.copy(huidig.up);
  const aspect = state.perspectiveCamera.aspect;
  state.camera = volgende;
  if (isOpenFem3DOrtho(volgende)) {
    openFem3DZetOrthoFrustum(volgende, openFem3DOrthoHalveHoogte(offset.length(), state.perspectiveCamera.fov), aspect);
    volgende.position.copy(doel).add(richting);
    plaatsOrthoCamera(state);
  } else {
    const afstand = openFem3DPerspectiefAfstand(
      openFem3DOrthoHalveHoogteVan(huidig as THREE.OrthographicCamera), volgende.fov,
    );
    volgende.position.copy(doel).addScaledVector(richting, afstand);
    volgende.near = Math.max(0.001, afstand / 10_000);
    volgende.far = Math.max(1_000, afstand * 100);
    volgende.updateProjectionMatrix();
  }
  volgende.lookAt(doel);
  volgende.updateMatrixWorld();
  state.controls.object = volgende;
  state.controls.update();
  return true;
}

/**
 * De camera zoals hij bewaard wordt (views, laatste camera). De positie is
 * in beide standen die van de perspectiefcamera met dezelfde zichtbare
 * grootte; in parallelle projectie komt de halve hoogte er exact bij
 * (`orthoHalfHeight`), zodat een view met perspective=false dezelfde schaal
 * terugkrijgt.
 */
function openFem3DCameraStateVan(state: SceneState): OpenFem3DCameraState {
  const camera = state.camera;
  const target = state.controls.target;
  const up = camera.up.toArray() as [number, number, number];
  if (!isOpenFem3DOrtho(camera)) {
    return { position: camera.position.toArray() as [number, number, number], target: target.toArray() as [number, number, number], up };
  }
  const orthoHalfHeight = openFem3DOrthoHalveHoogteVan(camera);
  const richting = camera.position.clone().sub(target).normalize();
  const position = target.clone().addScaledVector(richting, openFem3DPerspectiefAfstand(orthoHalfHeight, state.perspectiveCamera.fov));
  return {
    position: position.toArray() as [number, number, number], target: target.toArray() as [number, number, number], up,
    orthoHalfHeight,
  };
}

/**
 * Een bewaarde camera toepassen (view, laatste camera). In parallelle
 * projectie geeft `orthoHalfHeight` de schaal; ontbreekt die (een oude view),
 * dan de schaal die bij de afstand positie–doel hoort, zoals in perspectief.
 */
function pasOpenFem3DCameraStateToe(state: SceneState, cameraState: OpenFem3DCameraState) {
  const camera = state.camera;
  state.controls.target.fromArray(cameraState.target);
  camera.up.fromArray(cameraState.up);
  camera.position.fromArray(cameraState.position);
  if (isOpenFem3DOrtho(camera)) {
    const afstand = camera.position.distanceTo(state.controls.target);
    const halveHoogte = cameraState.orthoHalfHeight !== undefined && cameraState.orthoHalfHeight > 0
      ? cameraState.orthoHalfHeight : openFem3DOrthoHalveHoogte(afstand, state.perspectiveCamera.fov);
    openFem3DZetOrthoFrustum(camera, halveHoogte, state.perspectiveCamera.aspect);
    plaatsOrthoCamera(state);
  } else {
    camera.updateProjectionMatrix();
  }
  state.controls.update();
}

/**
 * Camera in kijkrichting `richting` (van het modelmidden naar de camera) met
 * `up`, rond het midden van het model op de passende afstand (perspectief) of
 * met de passende halve hoogte (parallel). Eén weg voor de lintaanzichten
 * (viewRequest) en de view cube, zodat vlak Boven precies hetzelfde beeld
 * geeft als de lintknop Boven.
 *
 * Met zichtbare peilmaten (issue #92) neemt het passende beeld hun
 * levelhoogtes mee, en maakt het links ruimte voor hun labels: die lopen
 * vanaf de modelrand naar links. Het bruikbare deel wordt zo veel smaller als
 * het breedste label, en het model schuift zo ver naar rechts als nodig is
 * (openFem3DPeilmaatVerschuivingPx); het doel schuift daarvoor mee.
 *
 * Met de section box aan (issue #86) past het beeld op wat er in de doos te
 * zien is: de doos, ingeperkt tot het model (een doos die ruimer is dan het
 * model laat zo geen lege rand); raakt de doos het model niet, de doos zelf.
 * De levelhoogtes van de peilmaten tellen dan niet mee.
 */
function aimOpenFem3DCamera(
  state: SceneState,
  model: OpenFem3DModel,
  visibility: OpenFem3DVisibility,
  richting: Vec3,
  up: Vec3,
) {
  let box = sceneBounds(model, visibility);
  const doos = state.sectionBox;
  if (doos) {
    const doosBox = new THREE.Box3(new THREE.Vector3(...doos.min), new THREE.Vector3(...doos.max));
    const binnen = box.isEmpty() ? doosBox : box.clone().intersect(doosBox);
    box = binnen.isEmpty() ? doosBox : binnen;
  }
  const hasGeometry = !box.isEmpty();
  const levelMarks = hasGeometry ? visibleLevelMarks(state) : null;
  const levelMarkSpace = Number(levelMarks?.userData.openFem3dLevelMarkSpacePx) || 0;
  const levelMarkZ = doos ? null : levelMarks?.userData.openFem3dLevelMarkZ as [number, number] | null | undefined;
  if (levelMarkZ) {
    box.min.z = Math.min(box.min.z, levelMarkZ[0]);
    box.max.z = Math.max(box.max.z, levelMarkZ[1]);
  }
  const center = hasGeometry ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  const direction = new THREE.Vector3(...richting).normalize();
  const camera = state.camera;
  camera.up.set(...up);
  state.controls.target.copy(center);
  const width = state.renderer.domElement.clientWidth, height = state.renderer.domElement.clientHeight;
  /** Schuif het doel zo dat het model zo ver naar rechts komt als de peilmaten vragen (wereldmaat per px bij het doel). */
  const maakRuimteVoorPeilmaten = (worldPerPx: number, modelHalfPx: number) => {
    if (levelMarkSpace <= 0 || !(worldPerPx > 0)) return;
    const nodig = openFem3DPeilmaatVerschuivingPx(width, usableViewport(width, height).breedte, modelHalfPx, levelMarkSpace);
    const right = new THREE.Vector3().crossVectors(camera.up, direction);
    if (nodig <= 0 || right.lengthSq() < 1e-12) return;
    state.controls.target.addScaledVector(right.normalize(), -nodig * worldPerPx);
  };
  if (isOpenFem3DOrtho(camera)) {
    const aspect = state.perspectiveCamera.aspect;
    const halfHeight = fittedOrthoHalfHeight(camera, aspect, box, direction, width, height, levelMarkSpace);
    openFem3DZetOrthoFrustum(camera, halfHeight, aspect);
    if (hasGeometry) {
      const worldPerPx = 2 * halfHeight / Math.max(height, 1);
      maakRuimteVoorPeilmaten(worldPerPx, projectedHalfExtents(camera.up, box, direction).halfWidth / worldPerPx);
    }
    camera.position.copy(state.controls.target).add(direction);
    plaatsOrthoCamera(state);
  } else {
    const distance = hasGeometry ? fittedCameraDistance(camera, box, direction, width, height, levelMarkSpace) : 4;
    if (hasGeometry) {
      // De halve modelbreedte op het scherm aan de voorkant van de begrenzing
      // (ruim: daar is ze het grootst); de verschuiving zelf bij het doel.
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const { halfWidth, halfDepth } = projectedHalfExtents(camera.up, box, direction);
      const modelHalfPx = halfWidth * height / (2 * Math.max(distance - halfDepth, 1e-6) * tan);
      maakRuimteVoorPeilmaten(2 * distance * tan / Math.max(height, 1), modelHalfPx);
    }
    camera.position.copy(state.controls.target).addScaledVector(direction, distance);
    camera.near = Math.max(0.001, distance / 10_000);
    camera.far = Math.max(1_000, distance * 100);
    camera.updateProjectionMatrix();
  }
  state.controls.update();
}

/**
 * Passend beeld: de huidige kijkrichting en up blijven, alleen midden en
 * afstand passen zich aan het model aan. Eén weg voor de knop Passend beeld,
 * het lint en het menu van de view cube; na een klik op Achter of een hoek
 * van de kubus draait het beeld dus niet weg.
 */
function fitOpenFem3DCamera(state: SceneState, model: OpenFem3DModel, visibility: OpenFem3DVisibility) {
  const offset = state.camera.position.clone().sub(state.controls.target);
  const richting: Vec3 = offset.lengthSq() > 0 ? [offset.x, offset.y, offset.z] : openFem3DAanzichtRichting("iso").richting;
  let up: Vec3 = [state.camera.up.x, state.camera.up.y, state.camera.up.z];
  // Up langs de kijkrichting (alleen bij een vreemde opgeslagen camera): de up-regel van de kubus.
  const kijk = new THREE.Vector3(...richting).normalize();
  if (new THREE.Vector3(...up).normalize().cross(kijk).lengthSq() < 1e-12) up = openFem3DViewCubeUp(richting);
  aimOpenFem3DCamera(state, model, visibility, richting, up);
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
  /** Bronpunt voor kopiëren met twee punten; vormt het werkvlak voor het doelpunt. */
  copyAnchor?: Punt3 | null;
  /** Een bron- of doelpunt aanklikken zonder de geselecteerde geometrie te veranderen. */
  onCopyPoint?: (point: Punt3) => void;
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
   * Oplegging- of veergereedschap: de klik landde op een knoop (of binnen de
   * snapzone), op een staaf (plek langs de staaf), op een plaat (punt op het
   * middenvlak) of op een punt van het werkvlak (leeg canvas). De aanroeper
   * zet er de voorwaarde, zo nodig met een nieuwe knoop of een gesplitste
   * staaf, in één modelwijziging. Een fout (bijv. een punt in een opening)
   * komt als melding in beeld.
   */
  onPlaceNodeCondition?: (target: OpenFem3DNodeTarget) => void;
  /**
   * Puntlastgereedschap (issue #77): de klik landde op een knoop (knooplast)
   * of op een staaf (staafpuntlast op die plek). Op een plaat of in leeg
   * canvas gebeurt niets, met een korte melding.
   */
  onPlacePointLoad?: (target: OpenFem3DPointLoadTarget) => void;
  /** Vergroting van de vervormde vorm en het onvervormde model erachter (weergavevoorkeur). */
  deformationDisplay?: OpenFem3DDeformationDisplay;
  /** Getallen bij de snedekrachtlijnen: Waarden aan/uit en de stand 1 … 5 (weergavevoorkeur, issue #95). */
  diagramLabels?: OpenFem3DDiagramLabels;
  /**
   * Het menu-item Perspectief van de view cube: zet de zichtbaarheid
   * `perspective` om (de aanroeper bewaart haar met de rest van de weergave).
   */
  onPerspectiveChange?: (perspective: boolean) => void;
  /**
   * De section box (issue #86) is veranderd: aan/uit of passend op de
   * selectie uit het menu ▾, of een vlak versleept (bij het loslaten; tijdens
   * het slepen houdt het tekenvlak de doos zelf bij). De aanroeper zet hem in
   * de zichtbaarheid (`sectionBox`) en bewaart hem met de rest van de weergave.
   */
  onSectionBoxChange?: (sectionBox: OpenFem3DSectionBox) => void;
  onExplodeChange?: (amountM: number) => void;
}

interface SceneState {
  scene: THREE.Scene;
  /** De actieve camera: `perspectiveCamera` of `orthographicCamera` (zichtbaarheid `perspective`). */
  camera: OpenFem3DCamera;
  perspectiveCamera: THREE.PerspectiveCamera;
  orthographicCamera: THREE.OrthographicCamera;
  /**
   * Een bol om model, raster en assen: de parallelle camera staat daarbuiten
   * (openFem3DOrthoAfstand), zodat niets achter de camera of het nabije vlak valt.
   */
  orthoBol: () => { middelpunt: THREE.Vector3; straal: number };
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  controls: OrbitControls;
  geometry: THREE.Group;
  draftLine: THREE.LineSegments;
  preview: THREE.Group;
  previewHint: HTMLSpanElement;
  /** Het maatlabel bij de staaf in aanbouw (#84): lengte en richting, of de getypte maat. */
  maatLabel: HTMLSpanElement;
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
  axisLabels: CSS2DObject[];
  /** De view cube rechtsboven; volgt de camera in writeCameraDiagnostics. */
  viewCube: OpenFem3DViewCubeDom | null;
  /**
   * Vlak vóór elke labelindeling (renderOpenFem3DLabels): een grote laag met
   * snedekrachtwaarden zet dan alleen de labels die in deze camerastand een
   * plek kunnen krijgen als element neer (zie thinDiagramLabelLayer).
   */
  beforeLabels?: (state: SceneState, container: HTMLElement | null) => void;
  /**
   * De peilmaatgroep (issue #92), zolang hij in `geometry` hangt: vóór elke
   * labelindeling hangen de labels aan de hoek die links ligt, en passend
   * beeld maakt links ruimte voor ze (replaceOpenFem3DLevelMarks).
   */
  levelMarks: THREE.Group | null;
  /**
   * De werkende section box (issue #86): de grenzen als hij aan staat, anders
   * null. Tijdens het slepen van een greep de live grenzen, nog niet in de
   * zichtbaarheid. Kiezen, kader, snappen, labels en passend beeld lezen hier.
   */
  sectionBox: OpenFem3DSectionBoxBounds | null;
  /** Clipping planes, randen en grepen van de section box. */
  sectionBoxBeeld: OpenFem3DSectionBoxBeeld;
  /** Staan er nu clipping planes op de materialen, of labels buiten de doos verborgen? */
  sectionBoxKnipt: { materialen: boolean; labels: boolean };
}

/** Prioriteit in de botsingsregel: lager wint (placeOpenFem3DLabels). */
function openFem3DLabelPriority(classList: { contains: (token: string) => boolean }): number {
  return classList.contains("open-fem3d-utilization-fail") ? 0
    : classList.contains("open-fem3d-diagram-peak-label")
      || classList.contains("open-fem3d-displacement-label") ? 1
      : classList.contains("open-fem3d-diagram-label") ? 2
        : classList.contains("open-fem3d-result-label") ? 3
          : classList.contains("open-fem3d-axis-label") ? 4
            : classList.contains("open-fem3d-utilization-label") ? 5
              : classList.contains("open-fem3d-node-label")
                || classList.contains("open-fem3d-beam-number") ? 6 : 7;
}

/**
 * Uitwijkplaatsen: alleen de kwartpuntlabels van stand 5 (issue #95). Hun
 * plek ligt vlak naast het begin- of eindlabel (dat iets binnen de staaf
 * staat); bezet, dan een regel omlaag of omhoog.
 */
function openFem3DLabelShifts(classList: { contains: (token: string) => boolean }, height: number): number[] | undefined {
  if (!classList.contains("open-fem3d-diagram-quarter-label")) return undefined;
  const step = Math.ceil(height) + 3;
  return [step, -step];
}

/** De verschuiving (px) die de indeling een label gaf: de gemeten rechthoek is daarmee verschoven. */
const openFem3DLabelShift = new WeakMap<HTMLElement, number>();

/**
 * De gereserveerde rechthoeken: de vaste titel, fitknop, status en eventuele
 * bedienpanelen liggen boven het WebGL-canvas. Hun rechthoeken zijn bezet
 * schermgebied, zodat knoop- en resultaatlabels deze bediening niet
 * overdrukken bij zoomen. Een verborgen view cube (of een gesloten menu) heeft
 * geen rechthoek en reserveert dus niets. De modelcontrole (issue #63) hoort
 * erbij: anders drukt een knoopnummer over "Knoop 3 ligt op staaf 1 …".
 */
function openFem3DReservedLabelRects(container: HTMLElement | null): DOMRect[] {
  return Array.from(container?.parentElement?.querySelectorAll<HTMLElement>(
    ".open-fem3d-stage-header, .open-fem3d-stage-footer, .open-fem3d-fit, .open-fem3d-model-check, "
    + ".open-fem3d-draw-error, .open-fem3d-transform-panel, .open-fem3d-uc-legend, .open-fem3d-profiel-legenda, "
    + ".open-fem3d-view-cube, .open-fem3d-view-cube-menu",
  ) ?? []).map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
}

/**
 * De laag waarop een label buiten de section box staat (issue #86). De camera
 * kijkt alleen naar laag 0, dus de CSS2DRenderer zet zo'n label op
 * display: none, zonder aan `visible` te komen (die zetten de lagen zelf).
 */
const OPEN_FEM_3D_LABEL_BUITEN_DOOS = 5;
const labelPositie = new THREE.Vector3();

/**
 * Labels werken alleen op wat binnen de section box valt: een label met zijn
 * ankerpunt buiten de doos verdwijnt (en krijgt geen plek in de indeling).
 * Labels van de oriëntatie (stramien, peilmaten, assen) blijven, zoals hun
 * lijnen. Vóór elke labelindeling; zonder doos één keer alles terug.
 */
function knipOpenFem3DLabels(state: SceneState, container: HTMLElement | null) {
  const doos = state.sectionBox;
  if (!doos && !state.sectionBoxKnipt.labels) return;
  state.scene.updateMatrixWorld();
  let buiten = 0;
  const bezoek = (object: THREE.Object3D) => {
    if (object !== state.scene && openFem3DSectionBoxNietKnippen(object)) return;
    if (object instanceof CSS2DObject) {
      const binnen = !doos || openFem3DSectionBoxBevat(doos, labelPositie.setFromMatrixPosition(object.matrixWorld));
      object.layers.set(binnen ? 0 : OPEN_FEM_3D_LABEL_BUITEN_DOOS);
      if (!binnen) buiten += 1;
    }
    for (const kind of object.children) bezoek(kind);
  };
  bezoek(state.scene);
  state.sectionBoxKnipt.labels = doos !== null;
  if (container) container.dataset.openFem3dSectionBoxLabelsBuiten = String(buiten);
}

function renderOpenFem3DLabels(state: SceneState, container: HTMLElement | null) {
  placeOpenFem3DLevelMarks(state);
  state.beforeLabels?.(state, container);
  knipOpenFem3DLabels(state, container);
  state.labelRenderer.render(state.scene, state.camera);
  const layer = state.labelRenderer.domElement;
  const labels = Array.from(layer.querySelectorAll<HTMLElement>(
    ".open-fem3d-result-label, .open-fem3d-utilization-label, .open-fem3d-profile-label, .open-fem3d-local-axis-label, "
    + ".open-fem3d-axis-label, .open-fem3d-node-label, .open-fem3d-beam-number, .open-fem3d-grid-label, .open-fem3d-level-mark",
  ));
  if (labels.length === 0) {
    if (container) {
      container.dataset.openFem3dOverlayLabelsShown = "0";
      container.dataset.openFem3dOverlayLabelsHidden = "0";
      container.dataset.openFem3dOverlayLabelsShifted = "0";
    }
    return;
  }
  const startedAt = performance.now();
  // visibility:hidden behoudt de DOMRect van een label. Meet ook verborgen
  // labels en pas hun zichtbaarheid na de collision-indeling aan. Een eerder
  // uitgeweken label wordt teruggerekend naar zijn eigen plek.
  const viewport = layer.getBoundingClientRect();
  const reserved = openFem3DReservedLabelRects(container);
  const candidates = labels.map((label) => {
    const box = label.getBoundingClientRect();
    const previous = openFem3DLabelShift.get(label) ?? 0;
    const rect: OpenFem3DLabelRect = { left: box.left, right: box.right, top: box.top - previous, bottom: box.bottom - previous };
    return { label, rect, width: box.width, height: box.height, previous };
  }).filter(({ width, height }) => width > 0 && height > 0);
  const placements = placeOpenFem3DLabels(candidates.map(({ label, rect, height }) => ({
    rect, priority: openFem3DLabelPriority(label.classList), shifts: openFem3DLabelShifts(label.classList, height),
  })), reserved, viewport);
  let shown = 0, hidden = 0, shiftedCount = 0;
  candidates.forEach(({ label, previous }, index) => {
    const placement = placements[index];
    if (placement.shown) {
      if (label.style.visibility) label.style.visibility = "";
      shown += 1;
    } else {
      if (label.style.visibility !== "hidden") label.style.visibility = "hidden";
      hidden += 1;
    }
    const shift = placement.shown ? placement.shift : 0;
    if (shift !== 0) shiftedCount += 1;
    if (shift !== previous) {
      // `translate` naast de `transform` van de CSS2DRenderer (die hem elke render overschrijft).
      label.style.translate = shift ? `0 ${shift}px` : "";
      if (shift) openFem3DLabelShift.set(label, shift); else openFem3DLabelShift.delete(label);
    }
  });
  if (container) {
    container.dataset.openFem3dOverlayLabelsShown = String(shown);
    container.dataset.openFem3dOverlayLabelsHidden = String(hidden);
    container.dataset.openFem3dOverlayLabelsShifted = String(shiftedCount);
    container.dataset.openFem3dOverlayLayoutMs = (performance.now() - startedAt).toFixed(2);
  }
}

const viewCubeRotation = new THREE.Matrix4();

function writeCameraDiagnostics(container: HTMLElement | null, state: SceneState) {
  // De view cube draait mee: alleen een transform, en alleen als de camera
  // werkelijk anders staat (zie openFem3dViewCubeDom.ts).
  if (state.viewCube) {
    const e = viewCubeRotation.makeRotationFromQuaternion(state.camera.quaternion).elements;
    state.viewCube.volg(openFem3DViewCubeMatrix({
      rechts: [e[0], e[1], e[2]], boven: [e[4], e[5], e[6]], achter: [e[8], e[9], e[10]],
    }));
  }
  if (!container) return;
  const value = (vector: THREE.Vector3) => vector.toArray().map((component) => component.toFixed(6)).join(",");
  container.dataset.openFem3dCameraPosition = value(state.camera.position);
  container.dataset.openFem3dCameraTarget = value(state.controls.target);
  container.dataset.openFem3dCameraUp = value(state.camera.up);
  // Perspectief of parallel, met de schaal: de halve hoogte van het frustum
  // (alleen parallel) en de wereldmaat per pixel bij het doel (beide standen).
  container.dataset.openFem3dProjection = isOpenFem3DOrtho(state.camera) ? "orthographic" : "perspective";
  if (isOpenFem3DOrtho(state.camera)) {
    container.dataset.openFem3dOrthoHalfHeight = openFem3DOrthoHalveHoogteVan(state.camera).toPrecision(12);
  } else {
    delete container.dataset.openFem3dOrthoHalfHeight;
  }
  container.dataset.openFem3dWorldPerPixel = openFem3DWereldmaatPerPixel(
    state.camera, state.controls.target, state.renderer.domElement.clientHeight,
  ).toPrecision(12);
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
const isPlateSketchTool = (tool: OpenFem3DTool) => tool === "addPlate" || tool === "addPlateArc" || tool === "addLoadPanel" || tool === "addEnvelopePanel";
/**
 * De gereedschappen die een punt op het werkvlak tekenen, met de tekenhulpen
 * van #84 (objectspoor, Shift als ortho, Alt, maat): knoop, staaf, plaat- en
 * belastingvlakomtrek en opening.
 */
const isTekenhulpTool = (tool: OpenFem3DTool) => tool === "addNode" || tool === "addBeam"
  || isPlateSketchTool(tool) || isOpeningTool(tool);

function createPlateMaterial(
  color = 0x94a3b8,
  style: OpenFem3DPlateDisplayStyle = OPEN_FEM_3D_PLATE_DISPLAY_STYLES.volume,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.01,
    transparent: true,
    opacity: style.opacity,
    side: THREE.DoubleSide,
    // Vlak en Mesh liggen op het middenvlak, net als de omtrek, de
    // elementlijnen en de resultaatcontour (die zelf 1 terugwijkt): het vlak
    // wijkt verder terug, zodat lijnen en contour er altijd voor liggen.
    ...(style.flat ? { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 } : {}),
  });
}

type PlateGeometryFor = (plate: NonNullable<OpenFem3DModel["plates"]>[number]) => OpenFem3DPlateGeometry | null;

/**
 * Eén plaat als object van het tekenvlak in de gekozen plaatweergave (issue
 * #78): het volume of het middenvlak, met de randen (volume) of de omtrek en
 * openingen (vlak, mesh) als lijnen. Kiesbaar op het vlak; de lijnen niet.
 */
function createPlateObject(built: OpenFem3DPlateGeometry, plateId: number, display: OpenFem3DPlateDisplay): THREE.Mesh {
  const style = OPEN_FEM_3D_PLATE_DISPLAY_STYLES[display];
  const mesh = new THREE.Mesh(built.geometry, createPlateMaterial(style.color, style));
  mesh.position.copy(built.position);
  mesh.quaternion.copy(built.quaternion);
  mesh.userData = {
    type: "plate", id: plateId, baseOpacity: style.opacity, selectionOpacity: style.selectionOpacity,
    openFem3dPlateDisplay: display,
  };
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(built.geometry, 22),
    new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: style.edgeOpacity }),
  );
  edges.userData = { type: "plate", id: plateId, selectionColor: 0x92400e, pickable: false };
  mesh.add(edges);
  return mesh;
}

/** Hoort dit kind van de scenegroep bij de plaatlaag (vlakken, batches of de gebundelde randen)? */
function isPlateLayerObject(object: THREE.Object3D): boolean {
  return object.userData.type === "plate" || object.userData.openFem3dPlateEdges === true;
}

/**
 * De plaatlaag in de gekozen plaatweergave: elke plaat als eigen object, of
 * vanaf 100 platen een GPU-batch per gelijke vorm met één gebundelde lijnlaag
 * voor alle randen. `owned` krijgt de plaatgeometrieën die aan de scène gaan
 * hangen; de overige mag de aanroeper vrijgeven.
 */
function buildPlateLayerObjects(
  plates: readonly NonNullable<OpenFem3DModel["plates"]>[number][],
  plateGeometryFor: PlateGeometryFor,
  display: OpenFem3DPlateDisplay,
  owned: Set<THREE.BufferGeometry>,
): THREE.Object3D[] {
  const style = OPEN_FEM_3D_PLATE_DISPLAY_STYLES[display];
  const objects: THREE.Object3D[] = [];
  if (plates.length < 100) {
    for (const plate of plates) {
      const built = plateGeometryFor(plate);
      if (!built) continue;
      owned.add(built.geometry);
      objects.push(createPlateObject(built, plate.id, display));
    }
    return objects;
  }
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
      owned.add(built.geometry);
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
      createPlateMaterial(0xffffff, style),
      batch.instances.length,
    );
    const instanceIds = batch.instances.map((instance) => instance.id);
    mesh.userData = {
      type: "plate",
      instanceIds,
      instanceBaseColors: new Array<number>(instanceIds.length).fill(style.color),
      instanceIndexById: new Map(instanceIds.map((id, index) => [id, index])),
      openFem3dPlateBatchKey: batchKey,
      openFem3dPlateDisplay: display,
    };
    batch.instances.forEach((instance, index) => {
      mesh.setMatrixAt(index, instance.matrix);
      mesh.setColorAt(index, new THREE.Color(style.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    objects.push(mesh);

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
      new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: style.edgeOpacity }),
    );
    edges.userData = { openFem3dPlateEdges: true, pickable: false };
    objects.push(edges);
  }
  return objects;
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
  "node", "beam", "plate", "envelopePanel", "nodalLoad", "memberLoad", "memberPointLoad", "thermalLoad", "surfaceLoad", "loadPanel",
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
  if (type === "envelopePanel") return [];
  // Lasten in een groepsselectie (selectiefilter, issue #94).
  return selection.loads?.[type] ?? [];
}

/**
 * De instanties van `id` in een GPU-batch. Knopen, staven en platen hebben één
 * instantie per id en houden `instanceIndexById` zelf bij, ook bij toevoegen
 * en verwijderen. Een batch markeringen tekent per last of knoop meerdere
 * instanties (alle pijlen van een lijnlast, steel en punt van een knooplast,
 * de delen van een oplegging) en verandert na het samenvoegen niet meer; die
 * indices worden eenmaal per batch verzameld (#81).
 */
function instanceIndicesOf(object: THREE.InstancedMesh, id: number): readonly number[] {
  const unique = object.userData.instanceIndexById as Map<number, number> | undefined;
  if (unique) {
    const index = unique.get(id);
    return index === undefined ? [] : [index];
  }
  const indicesById = (object.userData.instanceIndicesById ??= groupIndicesById(
    object.userData.instanceIds as number[])) as Map<number, number[]>;
  return indicesById.get(id) ?? [];
}

/** Per id de posities waarop die id in `ids` staat. */
function groupIndicesById(ids: readonly number[]): Map<number, number[]> {
  const grouped = new Map<number, number[]>();
  ids.forEach((id, index) => {
    const indices = grouped.get(id);
    if (indices) indices.push(index);
    else grouped.set(id, [index]);
  });
  return grouped;
}

/**
 * Een gedeelde lijn met een kleur per lijnstuk: de staartlijnen van alle
 * lijnlasten in één tekenaanroep (openFem3dMarkers.ts, met GPU-batches).
 * Kleurt de lijnstukken van de geselecteerde lasten en zet de vorige terug,
 * zoals de instanties van een batch (#81).
 */
function applySegmentSelectionHighlight(object: THREE.LineSegments, selectedIds: readonly number[]) {
  const ids = object.userData.segmentIds as number[];
  const baseColors = object.userData.segmentBaseColors as number[] | undefined;
  const colors = object.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!baseColors || baseColors.length !== ids.length || !colors || colors.count !== 2 * ids.length) return;
  const indicesById = (object.userData.segmentIndicesById ??= groupIndicesById(ids)) as Map<number, number[]>;
  const previous = object.userData.selectedSegmentIndices as Set<number> | undefined ?? new Set<number>();
  const next = new Set<number>();
  selectedIds.forEach((id) => {
    for (const index of indicesById.get(id) ?? []) next.add(index);
  });
  const color = new THREE.Color();
  let changed = false;
  new Set<number>([...previous, ...next]).forEach((index) => {
    const selected = next.has(index);
    if (selected === previous.has(index)) return;
    color.setHex(selected ? (object.userData.selectionColor ?? 0xffa31a) : baseColors[index]);
    // Beide eindpunten van het lijnstuk.
    colors.setXYZ(2 * index, color.r, color.g, color.b);
    colors.setXYZ(2 * index + 1, color.r, color.g, color.b);
    colors.addUpdateRange(2 * index * 3, 6);
    changed = true;
  });
  object.userData.selectedSegmentIndices = next;
  if (changed) colors.needsUpdate = true;
}

/**
 * Per getekend object: of het als geselecteerd gekleurd is en zijn eigen
 * basiskleur per materiaal. Niet in `userData`, want dat object delen de
 * delen van één teken soms (steel en punt van een lastpijl, ring, pijlen en
 * gradiëntring van een temperatuurlast): dan zette het eerste deel de vlag en
 * sloegen de andere delen de markering over (#81).
 */
const selectionHighlightStates = new WeakMap<THREE.Object3D, {
  selected?: boolean; baseColors: Array<number | undefined>;
}>();

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
      const previous = object.userData.selectedInstanceIndices as Set<number> | undefined ?? new Set<number>();
      const next = new Set<number>();
      selectedIdsForType(selection, type).forEach((id) => {
        for (const index of instanceIndicesOf(object, id)) next.add(index);
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
    if (object instanceof THREE.LineSegments && Array.isArray(object.userData.segmentIds)) {
      applySegmentSelectionHighlight(object, selectedIdsForType(selection, type));
      return;
    }
    const id = object.userData.id;
    if (typeof id !== "number") return;
    const drawable = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
    if (!drawable.material) return;
    const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
    let state = selectionHighlightStates.get(object);
    if (!state) {
      state = { baseColors: [] };
      selectionHighlightStates.set(object, state);
    }
    const baseColors = state.baseColors;
    const selected = openFem3DSelectionContains(selection, type, id);
    materials.forEach((material, index) => {
      const colored = material as THREE.Material & { color?: THREE.Color };
      if (!colored.color) return;
      if (baseColors[index] === undefined) baseColors[index] = colored.color.getHex();
    });
    if (state.selected === selected) return;
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
    state.selected = selected;
    // Gelezen door de schim- en contourweergave (doorzichtigheid). Delen die
    // hun userData delen, horen bij dezelfde last en zijn dus allemaal wel
    // of allemaal niet geselecteerd.
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

type DiagramComponent = OpenFem3DDiagramComponent;

const DIAGRAM_STYLE: Record<DiagramComponent, {
  symbol: string;
  unit: string;
  color: number;
  /** De punten van de lijn voor deze staaf; leeg = geen lijn. */
  samples: (result: OpenFem3DSolveResult, force: OpenFem3DMemberForces) => OpenFem3DDiagramPoint[];
  direction: (axes: ReturnType<typeof memberAxes>) => THREE.Vector3;
}> = {
  shearY: { symbol: "Vy", unit: "kN", color: 0x0284c7,
    samples: (result, f) => solverDiagramPoints(result, "shearY", f, [f.vyStartKn, f.vyEndKn]), direction: (axes) => openFem3DDiagramDirection("shearY", axes) },
  shearZ: { symbol: "Vz", unit: "kN", color: 0x7c3aed,
    samples: (result, f) => solverDiagramPoints(result, "shearZ", f, [f.vzStartKn, f.vzEndKn]), direction: (axes) => openFem3DDiagramDirection("shearZ", axes) },
  // Momentenlijnen aan de trekzijde; zie openFem3dDiagramSide.ts.
  momentY: { symbol: "My", unit: "kNm", color: 0xdc2626,
    samples: (result, f) => solverDiagramPoints(result, "momentY", f, [f.myStartKnm, f.myEndKnm]), direction: (axes) => openFem3DDiagramDirection("momentY", axes) },
  momentZ: { symbol: "Mz", unit: "kNm", color: 0xd97706,
    samples: (result, f) => solverDiagramPoints(result, "momentZ", f, [f.mzStartKnm, f.mzEndKnm]), direction: (axes) => openFem3DDiagramDirection("momentZ", axes) },
  // Gronddruk onder een staaf op bedding (#106), aan de kant van de grond;
  // alleen staven met bedding-uitvoer van de kern krijgen een lijn.
  groundPressure: { symbol: "p", unit: "kN/m", color: OPEN_FEM_3D_BEDDING_COLOR,
    samples: (result, f) => openFem3DBeddingPressurePoints(result, f.memberId), direction: (axes) => openFem3DDiagramDirection("groundPressure", axes) },
};

/**
 * Per lijst lijnen van de rekenkern de punten per staaf. Zonder deze index
 * zocht elke staaf de hele lijst door: kwadratisch in het aantal staven, en
 * de labellaag (issue #95) doet dat bij elke andere selectie of stand.
 */
const diagramPointsByMember = new WeakMap<readonly OpenFem3DMemberDiagram[], Map<number, OpenFem3DDiagramPoint[]>>();

/** De lijn van de kern voor een snedekracht; zonder lijn de twee eindwaarden. */
function solverDiagramPoints(
  result: OpenFem3DSolveResult,
  key: keyof OpenFem3DDiagrams,
  force: OpenFem3DMemberForces,
  fallback: [number, number],
): OpenFem3DDiagramPoint[] {
  const list = result.diagrams?.[key];
  let byMember = list ? diagramPointsByMember.get(list) : undefined;
  if (list && !byMember) {
    byMember = new Map();
    // De eerste lijn per staaf, zoals het zoeken met find deed.
    for (const diagram of list) if (!byMember.has(diagram.memberId)) byMember.set(diagram.memberId, diagram.points);
    diagramPointsByMember.set(list, byMember);
  }
  const calculated = byMember?.get(force.memberId);
  if (calculated && calculated.length >= 2) return calculated;
  return [{ t: 0, value: fallback[0] }, { t: 1, value: fallback[1] }];
}

function diagramPoints(
  result: OpenFem3DSolveResult,
  component: DiagramComponent,
  force: OpenFem3DMemberForces,
): OpenFem3DDiagramPoint[] {
  return DIAGRAM_STYLE[component].samples(result, force);
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

/** Het punt van de lijn op t (0 … 1) met waarde `value`, bij de schaal `scale` (m per eenheid). */
function diagramPoint(start: THREE.Vector3, end: THREE.Vector3, direction: THREE.Vector3, t: number, value: number, scale: number) {
  return start.clone().lerp(end, THREE.MathUtils.clamp(t, 0, 1)).addScaledVector(direction, value * scale);
}

/**
 * Teken één snedekrachtlijn (vlak, nullijn en kromme). De getallen erbij komen
 * uit een eigen laag (buildDiagramLabelLayer), zodat Waarden en de stand de
 * scène niet opnieuw opbouwen. Geeft terug of er iets getekend is.
 */
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
  batch?: ResultDiagramBatch,
): boolean {
  // Waarden die in de gekozen weergave overal als 0,000 verschijnen leveren
  // alleen overlappende labels en loze vlakgeometrie op.
  if (!(maximum > 1e-12) || !openFem3DDiagramDrawn(samples)) return false;
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
  return true;
}

/**
 * De schaal van de snedekrachtlijnen: per lijn het grootste |waarde| over alle
 * staven, en de hoogte die daarbij hoort. Gedeeld door de lijnen en hun labels.
 */
function diagramScale(model: OpenFem3DModel, result: OpenFem3DSolveResult, components: readonly DiagramComponent[]) {
  const maxima = new Map(components.map((component) => [
    component,
    result.memberForces.reduce((maximum, force) =>
      Math.max(maximum, ...diagramPoints(result, component, force).map((point) => Math.abs(point.value))), 0),
  ]));
  const modelBox = openFem3DNodeBounds(model);
  const height = Math.max(0.35, Math.min(3, modelBox.getSize(new THREE.Vector3()).length() * 0.085));
  return { maxima, height };
}

/**
 * Boven dit aantal labels zet de laag niet elk label als element neer, maar
 * alleen wat in de huidige camerastand een plek kan krijgen (zie
 * thinDiagramLabelLayer). Duizenden elementen waarvan er hooguit een paar
 * honderd in beeld passen, maakten elke klik en elke stand traag. Tot dit
 * aantal (elke stand van een gewoon model) staan alle labels er als element.
 */
const DIAGRAM_LABEL_DOM_LIMIT = 400;

/**
 * Geschatte maat van een resultaatlabel (OpenFem3DEditor.css: 700 10px/1.25,
 * padding 2px 5px, rand 1px) en zijn ligging ten opzichte van het ankerpunt
 * (de marges per lijn). Alleen voor het uitdunnen; de echte indeling meet de
 * elementen zelf (renderOpenFem3DLabels).
 */
const RESULT_LABEL_HEIGHT_PX = 19;
const resultLabelWidthPx = (text: string) => 12 + 6.2 * text.length;
const DIAGRAM_LABEL_MARGIN_TOP_PX: Record<DiagramComponent, number> = { shearY: -38, shearZ: -18, momentY: 2, momentZ: 22, groundPressure: 42 };

/** Eén getal van de labellaag; `object` is het element zodra het er staat. */
interface DiagramLabelSpec {
  text: string;
  className: string;
  position: THREE.Vector3;
  beamId: number;
  /** Een geselecteerde staaf of de maatgevende waarde: altijd een element, ook uitgedund. */
  always: boolean;
  /** Voor het uitdunnen: prioriteit, uitwijken (kwartpunten) en de geschatte rechthoek t.o.v. het ankerpunt. */
  priority: number;
  quarter: boolean;
  dx: number;
  dy: number;
  width: number;
  object: CSS2DObject | null;
}

interface DiagramLabelLayer {
  group: THREE.Group;
  specs: DiagramLabelSpec[];
  /** Meer labels dan DIAGRAM_LABEL_DOM_LIMIT: alleen wat in beeld past wordt een element. */
  thinned: boolean;
  /** Camera, beeld en bediening van de laatste uitdunning: gelijk gebleven, dan niets te doen. */
  thinKey: string;
}

function materializeDiagramLabel(group: THREE.Group, spec: DiagramLabelSpec) {
  const label = makeLabel(spec.text, spec.className, spec.position);
  label.element.dataset.openFem3dBeam = String(spec.beamId);
  spec.object = label;
  group.add(label);
}

const diagramLabelElements = (layer: DiagramLabelLayer) =>
  layer.specs.reduce((count, spec) => count + (spec.object ? 1 : 0), 0);

/**
 * De getallen bij de snedekrachtlijnen en de N/T-labels op het staafmidden,
 * als eigen laag (issue #95). Welke staaf welke labels krijgt, bepaalt het
 * plan (openFem3dDiagramLabels.ts) uit Waarden, de stand en de selectie; hier
 * alleen de plek en de tekst. De eindwaarden staan iets binnen de staaf: op
 * een gedeelde knoop zouden alle staafeindlabels anders exact over elkaar
 * vallen. De diagramlijn zelf loopt gewoon tot beide knopen door. Een groot
 * plan wordt uitgedund (thinDiagramLabelLayer); anders staat elk label er
 * meteen, in de volgorde van het plan.
 */
function buildDiagramLabelLayer(
  model: OpenFem3DModel,
  result: OpenFem3DSolveResult,
  visibility: OpenFem3DVisibility,
  labels: OpenFem3DDiagramLabels,
  selectedBeamIds: readonly number[],
): DiagramLabelLayer {
  const group = new THREE.Group();
  group.userData.openFem3dDiagramLabels = true;
  const layer: DiagramLabelLayer = { group, specs: [], thinned: false, thinKey: "" };
  const components = (Object.keys(DIAGRAM_STYLE) as DiagramComponent[]).filter((component) => visibility[component]);
  const mids = OPEN_FEM_3D_MID_FORCES.filter((component) => visibility[component]);
  if (!labels.show || (components.length === 0 && mids.length === 0)) return layer;
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const forceByMember = new Map(result.memberForces.map((force) => [force.memberId, force]));
  const { maxima, height } = diagramScale(model, result, components);
  const geometryByBeam = new Map<number, { a: THREE.Vector3; b: THREE.Vector3; axes: ReturnType<typeof memberAxes> }>();
  const input: OpenFem3DDiagramLabelBeam[] = [];
  for (const [index, beam] of model.beams.entries()) {
    const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
    const force = forceByMember.get(beam.id);
    if (!start || !end || !force) continue;
    const a = new THREE.Vector3(start.x, start.y, start.z);
    const b = new THREE.Vector3(end.x, end.y, end.z);
    geometryByBeam.set(beam.id, { a, b, axes: memberAxes(b.clone().sub(a), beam.rollAngleRad ?? 0) });
    input.push({
      beamId: beam.id, index,
      // Alleen lijnen die ook getekend worden (zonder schaal geen lijn).
      diagrams: Object.fromEntries(components.filter((component) => (maxima.get(component) ?? 0) > 1e-12)
        .map((component) => [component, diagramPoints(result, component, force)])),
      mid: Object.fromEntries(mids.map((component) => [component, component === "axialForce"
        ? Math.max(Math.abs(force.nStartKn), Math.abs(force.nEndKn))
        : Math.max(Math.abs(force.torsionStartKnm), Math.abs(force.torsionEndKnm))])),
    });
  }
  const plan = planOpenFem3DDiagramLabels(input, { beamCount: model.beams.length, labels, selectedBeamIds });
  const selected = new Set(selectedBeamIds);
  const inputByBeam = new Map(input.map((beam) => [beam.beamId, beam]));
  const priorityOf = (className: string) => {
    const classes = className.split(" ");
    return openFem3DLabelPriority({ contains: (token) => classes.includes(token) });
  };
  for (const planned of plan.beams) {
    const geometry = geometryByBeam.get(planned.beamId)!;
    for (const { component, labels: beamLabels } of planned.diagrams) {
      const style = DIAGRAM_STYLE[component];
      const samples = inputByBeam.get(planned.beamId)!.diagrams[component]!;
      const scale = height / (maxima.get(component) ?? 1);
      const direction = style.direction(geometry.axes);
      const labelClass = `open-fem3d-result-label open-fem3d-diagram-label open-fem3d-diagram-${style.symbol.toLowerCase()}`;
      const always = selected.has(planned.beamId) || plan.governingBeamIds[component] === planned.beamId;
      for (const label of beamLabels) {
        const position = label.sample !== undefined
          ? diagramPoint(geometry.a, geometry.b, direction, samples[label.sample].t, samples[label.sample].value, scale)
          : diagramPoint(geometry.a, geometry.b, direction, label.t ?? 0.5, openFem3DDiagramValueAt(samples, label.t ?? 0.5), scale);
        // Het uiterste gaat bij een botsing voor (renderOpenFem3DLabels).
        const kindClass = label.kind === "peak" || label.kind === "extreme" ? " open-fem3d-diagram-peak-label"
          : label.kind === "quarter" ? " open-fem3d-diagram-quarter-label" : "";
        const text = `${style.symbol} ${signedDiagramValue(label.value)} ${style.unit}`;
        const className = labelClass + kindClass;
        layer.specs.push({
          text, className, position, beamId: planned.beamId, always,
          priority: priorityOf(className), quarter: label.kind === "quarter",
          dx: 7, dy: DIAGRAM_LABEL_MARGIN_TOP_PX[component], width: resultLabelWidthPx(text), object: null,
        });
      }
    }
    if (planned.mid.length > 0) {
      const text = planned.mid.map(({ component, value }) => component === "axialForce"
        ? `N ${value.toFixed(2)} kN` : `T ${value.toFixed(2)} kNm`).join(" · ");
      const className = "open-fem3d-result-label open-fem3d-member-force-label";
      layer.specs.push({
        text, className, position: geometry.a.clone().add(geometry.b).multiplyScalar(0.5), beamId: planned.beamId,
        always: selected.has(planned.beamId)
          || planned.mid.some(({ component }) => plan.governingBeamIds[component] === planned.beamId),
        priority: priorityOf(className), quarter: false, dx: 8, dy: -18, width: resultLabelWidthPx(text), object: null,
      });
    }
  }
  layer.thinned = layer.specs.length > DIAGRAM_LABEL_DOM_LIMIT;
  if (!layer.thinned) layer.specs.forEach((spec) => materializeDiagramLabel(group, spec));
  return layer;
}

/**
 * Een uitgedunde labellaag, vlak vóór de labelindeling (SceneState.beforeLabels):
 * projecteer elk label van het plan, schat zijn rechthoek en deel ze in met
 * dezelfde botsingsregel als de echte indeling (placeOpenFem3DLabels, met de
 * bediening als gereserveerd gebied). Alleen wat daarbij een plek krijgt, plus
 * de geselecteerde staven en de maatgevende waarden, wordt een element; de
 * rest gaat uit de DOM. Het aantal elementen hangt zo af van de grootte van
 * het beeld, niet van het model. Zelfde camera, beeld en bediening als de
 * vorige keer: niets te doen.
 */
function thinDiagramLabelLayer(state: SceneState, container: HTMLElement | null, layer: DiagramLabelLayer) {
  if (!layer.thinned || !layer.group.parent) return;
  const startedAt = performance.now();
  const box = state.labelRenderer.domElement.getBoundingClientRect();
  const reserved = openFem3DReservedLabelRects(container);
  state.camera.updateMatrixWorld();
  layer.group.updateWorldMatrix(true, false);
  const toClip = new THREE.Matrix4()
    .multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse)
    .multiply(layer.group.matrixWorld);
  // De section box (issue #86) hoort bij de sleutel: een label buiten de doos
  // doet niet mee en mag een label binnen de doos zijn plek niet afnemen.
  const doos = state.sectionBox;
  const key = [...toClip.elements, box.left, box.top, box.width, box.height,
    ...reserved.flatMap((rect) => [rect.left, rect.top, rect.right, rect.bottom]),
    ...(doos ? [...doos.min, ...doos.max] : [])]
    .map((value) => value.toPrecision(10)).join(",");
  if (key === layer.thinKey) return;
  layer.thinKey = key;
  const point = new THREE.Vector3();
  const candidates: OpenFem3DLabelCandidate[] = [];
  const indices: number[] = [];
  const step = RESULT_LABEL_HEIGHT_PX + 3;
  layer.specs.forEach((spec, index) => {
    if (doos && !openFem3DSectionBoxBevat(doos, spec.position)) return;
    point.copy(spec.position).applyMatrix4(toClip);
    // Achter de camera of voorbij het verre vlak: de CSS2DRenderer toont het niet.
    if (!(point.z >= -1 && point.z <= 1)) return;
    const left = box.left + (point.x + 1) / 2 * box.width + spec.dx;
    const bottom = box.top + (1 - point.y) / 2 * box.height + spec.dy;
    candidates.push({
      rect: { left, right: left + spec.width, top: bottom - RESULT_LABEL_HEIGHT_PX, bottom },
      priority: spec.priority, shifts: spec.quarter ? [step, -step] : undefined,
    });
    indices.push(index);
  });
  const wanted = new Set<number>();
  placeOpenFem3DLabels(candidates, reserved, box).forEach((placement, k) => {
    if (placement.shown) wanted.add(indices[k]);
  });
  layer.specs.forEach((spec, index) => {
    const keep = spec.always || wanted.has(index);
    if (keep && !spec.object) {
      materializeDiagramLabel(layer.group, spec);
    } else if (!keep && spec.object) {
      spec.object.removeFromParent();
      spec.object.element.remove();
      spec.object = null;
    }
  });
  if (container) {
    container.dataset.openFem3dDiagramLabelElements = String(diagramLabelElements(layer));
    container.dataset.openFem3dDiagramLabelThinMs = (performance.now() - startedAt).toFixed(2);
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

/** Stramienlijnen als streep-stip, schermvast (issue #103; openFem3dStramienLijn.ts). */
function addStramienSegments(group: THREE.Group, points: THREE.Vector3[], color = OPEN_FEM_3D_STRAMIEN_KLEUR) {
  const lines = maakOpenFem3DStramienLijnen(points, color);
  if (lines) group.add(lines);
}

function structuralGridLayout(model: OpenFem3DModel, grid: StructuralGrid) {
  return openFem3DStramienKader(model.nodes, grid);
}

function structuralGridLayoutKey(model: OpenFem3DModel, grid: StructuralGrid): string {
  const layout = structuralGridLayout(model, grid);
  return [layout.xMin, layout.xMax, layout.yMin, layout.yMax, layout.zMin, layout.zMax, layout.baseZ].join("|");
}

function addStructuralGrid(group: THREE.Group, model: OpenFem3DModel, grid: StructuralGrid) {
  if (!grid.enabled) return;
  const kader = structuralGridLayout(model, grid);
  const { xMin, xMax, yMin, yMax, zMin, zMax, baseZ } = kader;
  const baseSegments: THREE.Vector3[] = [];
  const levelSegments: THREE.Vector3[] = [];
  // De lijnen en snap-assen blijven alle aanwezig; alleen de zichtbare tekst
  // wordt gelijkmatig uitgedund (openFem3DLabelStride).
  const xLabelStride = openFem3DLabelStride(grid.xAxes.length);
  const yLabelStride = openFem3DLabelStride(grid.yAxes?.length ?? 0);

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
  // De stippelrechthoek per level. De naam en hoogte van het level staan in
  // de peilmaat, een eigen laag los van het stramien (addLevelMarks).
  for (const { hoeken } of openFem3DLevelRechthoeken(grid.zAxes, kader)) {
    const corners = hoeken.map((hoek) => new THREE.Vector3(...hoek));
    corners.forEach((corner, index) => levelSegments.push(corner, corners[(index + 1) % corners.length]));
  }
  if (grid.zAxes.length === 0) {
    levelSegments.push(new THREE.Vector3(xMin, yMin, zMin), new THREE.Vector3(xMin, yMin, zMax));
  }
  addStramienSegments(group, baseSegments);
  addStramienSegments(group, levelSegments, OPEN_FEM_3D_STRAMIEN_LEVEL_KLEUR);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * De peilmaat als DOM-label (issue #92), zoals in 2D: de tekst links van het
 * peildriehoekje, de punt van het driehoekje op een kort horizontaal streepje
 * dat naar het model loopt. Het label hangt met zijn rechteronderhoek aan het
 * ankerpunt (center 1, 1): de hoek van de modelrand op de levelhoogte. De
 * opvulling rechts houdt het streepje AFSTAND_PX van die hoek vrij; streepje
 * en punt liggen op de onderkant van het label, dus op de levelhoogte.
 * Driehoek en maten zijn die van 2D (lib/peilmaat.ts); de punt staat op
 * `openFem3DPeilmaatPuntPx()` van het ankerpunt.
 */
function makeLevelMarkLabel(peilmaat: OpenFem3DPeilmaat): CSS2DObject {
  const element = document.createElement("span");
  element.className = "open-fem3d-level-mark";
  element.dataset.openFem3dLevelMark = peilmaat.levelId;
  // Diagnose: de rand (xMin, xMax, yMin, yMax in m) en de hoogte waaraan hij hangt.
  const [[xMin, yMin], , [xMax, yMax]] = peilmaat.hoeken;
  element.dataset.openFem3dLevelMarkRand = [xMin, xMax, yMin, yMax].join(",");
  element.dataset.openFem3dLevelMarkZ = String(peilmaat.z);
  element.style.paddingRight = `${OPEN_FEM_3D_PEILMAAT_AFSTAND_PX}px`;
  const tekst = document.createElement("span");
  tekst.className = "open-fem3d-level-mark-tekst";
  tekst.textContent = peilmaat.tekst;
  const half = PEIL_DRIEHOEK_HALF_PX;
  const hoogte = PEIL_DRIEHOEK_HOOGTE_PX;
  const breedte = half + OPEN_FEM_3D_PEILMAAT_STREEP_PX;
  const peil = document.createElementNS(SVG_NS, "svg");
  peil.setAttribute("class", "open-fem3d-level-mark-peil");
  peil.setAttribute("width", String(breedte));
  peil.setAttribute("height", String(hoogte));
  peil.setAttribute("viewBox", `0 0 ${breedte} ${hoogte}`);
  peil.setAttribute("overflow", "visible");
  peil.setAttribute("aria-hidden", "true");
  const streep = document.createElementNS(SVG_NS, "line");
  streep.setAttribute("class", "open-fem3d-level-mark-streep");
  streep.setAttribute("x1", String(half));
  streep.setAttribute("y1", String(hoogte));
  streep.setAttribute("x2", String(breedte));
  streep.setAttribute("y2", String(hoogte));
  const driehoek = document.createElementNS(SVG_NS, "polygon");
  driehoek.setAttribute("class", "open-fem3d-level-mark-driehoek");
  driehoek.setAttribute("points", `0,0 ${2 * half},0 ${half},${hoogte}`);
  peil.append(streep, driehoek);
  element.append(tekst, peil);
  const label = new CSS2DObject(element);
  label.position.set(...peilmaat.hoeken[0]);
  label.center.set(1, 1);
  return label;
}

/** Per peilmaat het label en de vier hoeken van de rand waaraan het kan hangen. */
interface OpenFem3DPeilmaatLabel {
  label: CSS2DObject;
  hoeken: readonly OpenFem3DPunt[];
}

/** De labels van een peilmaatgroep (buiten userData: dat blijft kopieerbaar). */
const levelMarkLabels = new WeakMap<THREE.Group, OpenFem3DPeilmaatLabel[]>();

/**
 * De rand van het model voor de peilmaten: de begrenzing van passend beeld
 * (knopen plus knoopbol en profiel, `sceneBounds`) in x en y; zonder knopen
 * het stramienkader.
 */
function levelMarkRand(model: OpenFem3DModel, grid: StructuralGrid, visibility: OpenFem3DVisibility) {
  const box = sceneBounds(model, visibility);
  return openFem3DPeilmaatRand(
    box.isEmpty() ? null : { xMin: box.min.x, xMax: box.max.x, yMin: box.min.y, yMax: box.max.y },
    structuralGridLayout(model, grid),
  );
}

/** Waarbij een peilmaatgroep hoort: aan/uit zetten hergebruikt hem alleen bij dezelfde rand en levels. */
function levelMarksLayoutKey(rand: ReturnType<typeof levelMarkRand>, grid: StructuralGrid): string {
  return [rand.xMin, rand.xMax, rand.yMin, rand.yMax, ...grid.zAxes.map((level) => `${level.id}@${level.position}:${level.label}`)]
    .join("|");
}

/**
 * De peilmaten bij de levels (issue #92): per level één label. Een eigen
 * groep, los van het stramien: ook zichtbaar als het stramien uit staat, en
 * apart uit te zetten. Het tekenvlak hangt elk label vóór elke labelindeling
 * aan de hoek die in deze camerastand links ligt (placeOpenFem3DLevelMarks);
 * passend beeld leest hier hoeveel ruimte ze links vragen.
 */
function addLevelMarks(group: THREE.Group, model: OpenFem3DModel, grid: StructuralGrid, visibility: OpenFem3DVisibility) {
  const rand = levelMarkRand(model, grid, visibility);
  group.userData.openFem3dLevelMarks = true;
  group.userData.openFem3dLayoutKey = levelMarksLayoutKey(rand, grid);
  const peilmaten = openFem3DPeilmaten(grid.zAxes, rand);
  levelMarkLabels.set(group, peilmaten.map((peilmaat) => {
    const label = makeLevelMarkLabel(peilmaat);
    group.add(label);
    return { label, hoeken: peilmaat.hoeken };
  }));
  group.userData.openFem3dLevelMarkSpacePx = openFem3DPeilmaatRuimtePx(peilmaten);
  group.userData.openFem3dLevelMarkZ = peilmaten.length === 0 ? null
    : [Math.min(...peilmaten.map(({ z }) => z)), Math.max(...peilmaten.map(({ z }) => z))];
}

/**
 * Vervang de peilmaatgroep van het tekenvlak: de oude weg, en een nieuwe als
 * de peilmaten zichtbaar zijn. Eén weg voor de volledige opbouw en de snelle
 * paden waarin de modelrand verandert (knopen buiten de oude begrenzing).
 */
function replaceOpenFem3DLevelMarks(
  state: SceneState,
  model: OpenFem3DModel,
  grid: StructuralGrid | undefined,
  visibility: OpenFem3DVisibility,
) {
  const old = state.geometry.children.find((child) => child.userData.openFem3dLevelMarks === true);
  if (old instanceof THREE.Group) {
    disposeGroup(old);
    state.geometry.remove(old);
  }
  state.levelMarks = null;
  if (!grid || !openFem3DLevelZichtbaarheid(visibility, grid).peilmaten) return;
  const group = new THREE.Group();
  addLevelMarks(group, model, grid, visibility);
  state.geometry.add(group);
  state.levelMarks = group;
}

/** De zichtbare peilmaatgroep van het tekenvlak, of null. */
function visibleLevelMarks(state: SceneState): THREE.Group | null {
  const group = state.levelMarks;
  return group && group.parent === state.geometry && group.visible ? group : null;
}

const levelMarkCorner = new THREE.Vector3();
const levelMarkOffset = new THREE.Vector3();
const levelMarkForward = new THREE.Vector3();

/**
 * Hang elke peilmaat aan de hoek van de modelrand die in deze camerastand op
 * het scherm links ligt (bij gelijke stand de dichtstbijzijnde,
 * openFem3DPeilmaatHoek). Het label loopt vanaf die hoek naar links, dus van
 * het model af: in elke kijkrichting buiten het model. Vóór elke labelindeling
 * (renderOpenFem3DLabels): de CSS2DRenderer zet de labels daarna neer.
 */
function placeOpenFem3DLevelMarks(state: SceneState) {
  const group = visibleLevelMarks(state);
  if (!group) return;
  const camera = state.camera;
  camera.updateMatrixWorld();
  camera.getWorldDirection(levelMarkForward);
  const ortho = isOpenFem3DOrtho(camera);
  const projecteer = (punt: OpenFem3DPunt) => {
    levelMarkCorner.set(punt[0], punt[1], punt[2]);
    const diepte = levelMarkOffset.copy(levelMarkCorner).sub(camera.position).dot(levelMarkForward);
    // Achter een perspectiefcamera kantelt de projectie om: die hoek telt niet
    // mee. De parallelle camera staat buiten model en raster (plaatsOrthoCamera).
    if (!ortho && diepte <= camera.near) return null;
    levelMarkCorner.project(camera);
    return { x: levelMarkCorner.x, diepte: Math.max(diepte, 1e-12) };
  };
  for (const { label, hoeken } of levelMarkLabels.get(group) ?? []) {
    label.position.set(...hoeken[openFem3DPeilmaatHoek(hoeken, projecteer)]);
  }
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
    // Een verlopende staaf (#73) verloopt ook in de vervormde vorm.
    const sections = profiles ? openFem3DBeamSweepSections(beam) : null;
    if (sections) {
      const delta = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
      sweeps.push({ ...sections, points, referenceY: memberAxes(delta, beam.rollAngleRad ?? 0).ey });
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

export default function ThreeFrameCanvas({ model, conditionModel, onChange, onDrawError, tool, selection, onSelect, copyAnchor = null, onCopyPoint, onOpenCheckForBeam, fitToken, visibility, viewRequest, currentView = "iso", structuralGrid, gridSpacingM = 0.5, workPlaneZ = 0, result, utilizations = [], activeLoadCaseId, cameraRequest, onCameraChange, onCameraViewChange, loadCaseTypes, onToolChange, onPlaceNodeCondition, onPlacePointLoad, deformationDisplay, diagramLabels, plateMesh = null, plateQuantity = null, onPerspectiveChange, onSectionBoxChange, onExplodeChange }: Props) {
  const { t, i18n } = useTranslation("ribbon");
  const containerRef = useRef<HTMLDivElement>(null);
  const viewCubeTeksten = useMemo<OpenFem3DViewCubeTeksten & {
    start: string; passend: string; perspectief: string; sectionBox: string; sectionBoxSelectie: string; sectionBoxReset: string; explode: string;
  }>(() => ({
    kubus: t("openFem3d.viewCube.label"),
    vlak: {
      boven: t("openFem3d.viewCube.vlak.boven"), onder: t("openFem3d.viewCube.vlak.onder"),
      voor: t("openFem3d.viewCube.vlak.voor"), achter: t("openFem3d.viewCube.vlak.achter"),
      links: t("openFem3d.viewCube.vlak.links"), rechts: t("openFem3d.viewCube.vlak.rechts"),
    },
    aanzicht: {
      boven: t("openFem3d.viewCube.aanzicht.boven"), onder: t("openFem3d.viewCube.aanzicht.onder"),
      voor: t("openFem3d.viewCube.aanzicht.voor"), achter: t("openFem3d.viewCube.aanzicht.achter"),
      links: t("openFem3d.viewCube.aanzicht.links"), rechts: t("openFem3d.viewCube.aanzicht.rechts"),
    },
    ribbe: (namen) => t("openFem3d.viewCube.ribbe", { namen, interpolation: { escapeValue: false } }),
    hoek: (namen) => t("openFem3d.viewCube.hoek", { namen, interpolation: { escapeValue: false } }),
    menu: t("openFem3d.viewCube.menu"),
    // Menu ▾: Startaanzicht, Passend beeld (dezelfde tekst als de knop) en
    // Perspectief (dezelfde tekst als de schakelaar in de zichtbaarheid).
    start: t("openFem3d.viewCube.start"),
    passend: t("openFem3d.fit"),
    perspectief: t("openFem3dVisibility.perspective", { ns: "common" }),
    // De section box (issue #86): aan/uit, passend op de selectie en terug op de modelgrenzen.
    sectionBox: t("openFem3d.viewCube.sectionBox"),
    sectionBoxSelectie: t("openFem3d.viewCube.sectionBoxSelectie"),
    sectionBoxReset: t("openFem3d.viewCube.sectionBoxReset"),
    explode: t("openFem3d.explode"),
  }), [t]);
  const viewCubeTekstenRef = useRef(viewCubeTeksten);
  viewCubeTekstenRef.current = viewCubeTeksten;
  /** De melding van het puntlastgereedschap naast een knoop of staaf (in de taal van nu). */
  const pointLoadMissedTextRef = useRef("");
  pointLoadMissedTextRef.current = t("openFem3d.pointLoadPlacementMissed");
  /**
   * Teksten van de tekenhulp (#84) bij de cursor, in de taal van nu. Zonder
   * HTML-escape: de tekst gaat als textContent het beeld in.
   */
  const spoorVertaalRef = useRef<(sleutel: string, waarden?: Record<string, string | number>) => string>(() => "");
  spoorVertaalRef.current = (sleutel, waarden = {}) => t(sleutel, { ...waarden, interpolation: { escapeValue: false } });
  const taalRef = useRef(i18n.language);
  taalRef.current = i18n.language;
  /** De regels van het menu ▾ bij de kubus; gezet in het opbouweffect (daar staan de camera-acties). */
  const viewCubeMenuRef = useRef<((teksten: typeof viewCubeTeksten) => OpenFem3DViewCubeMenuItem[]) | null>(null);
  const perspectiveChangeRef = useRef(onPerspectiveChange);
  perspectiveChangeRef.current = onPerspectiveChange;
  const sectionBoxChangeRef = useRef(onSectionBoxChange);
  sectionBoxChangeRef.current = onSectionBoxChange;
  const explodeChangeRef = useRef(onExplodeChange);
  explodeChangeRef.current = onExplodeChange;
  /** Zet de section box in het tekenvlak (vlakken, grepen, kiezen, snappen); gezet in het opbouweffect. */
  const sectionBoxToepassenRef = useRef<((box: OpenFem3DSectionBox) => void) | null>(null);
  /** Wissel perspectief/parallel; gezet in het opbouweffect (daar staan camera, besturing en tekenen). */
  const projectieRef = useRef<((perspectief: boolean) => void) | null>(null);
  // Een nieuw getekend belastingvlak hoort bij het geval dat nu in beeld is.
  const activeLoadCaseIdRef = useRef(activeLoadCaseId);
  activeLoadCaseIdRef.current = activeLoadCaseId;
  const sceneRef = useRef<SceneState | null>(null);
  // Het verzoek (token) waarvoor de camera het laatst in een lintaanzicht is gezet;
  // `false` = nog nooit in deze scène (het eerste beeld is altijd een lintaanzicht).
  const aimedViewTokenRef = useRef<number | undefined | false>(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const copyAnchorRef = useRef(copyAnchor);
  copyAnchorRef.current = copyAnchor;
  const copyPointRef = useRef(onCopyPoint);
  copyPointRef.current = onCopyPoint;
  const toolChangeRef = useRef(onToolChange);
  toolChangeRef.current = onToolChange;
  const placeNodeConditionRef = useRef(onPlaceNodeCondition);
  placeNodeConditionRef.current = onPlaceNodeCondition;
  const placePointLoadRef = useRef(onPlacePointLoad);
  placePointLoadRef.current = onPlacePointLoad;
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
  /**
   * De zichtbaarheid die de scène het laatst langs een snel pad van de
   * regelaars Knopen of Opleggingen verwerkte (issue #82): dan hoeft de
   * plaatlaag niet opnieuw (zie het effect van de plaatlaag).
   */
  const symbolScalePathRef = useRef<{ visibility: OpenFem3DVisibility; kind: "node" | "support" } | null>(null);
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
  /**
   * Tekenhulpen (#84): de verworven knopen en staven van het objectspoor, de
   * stand van Alt en Shift (de laatste muis- of toetsgebeurtenis) en de
   * getypte maat. Ze horen bij het lopende gereedschap: een ander gereedschap
   * begint leeg.
   */
  const spoorVerworvenRef = useRef<readonly VerworvenItem[]>([]);
  const tekenToetsenRef = useRef({ alt: false, shift: false });
  const maatInvoerRef = useRef<string | null>(null);
  useEffect(() => {
    // Na een modelwijziging (ook ongedaan maken) volgen de verworven items het
    // model; verdwenen knopen en staven vallen weg.
    spoorVerworvenRef.current = verworvenNaModel(spoorVerworvenRef.current, nodeByIdRef.current!, beamByIdRef.current!);
  }, [model.nodes, model.beams]);
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
      || (previousTool === "addLoadPanel" && tool === "addLoadPanel")
      || (previousTool === "addEnvelopePanel" && tool === "addEnvelopePanel");
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
    if (previousTool !== tool) {
      spoorVerworvenRef.current = [];
      maatInvoerRef.current = null;
      if (containerRef.current) containerRef.current.dataset.openFem3dMaatInvoer = "";
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
      state.maatLabel.hidden = true;
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
    }
  }, [tool]);

  const copyPointAvailable = onCopyPoint !== undefined;
  useEffect(() => {
    if (tool !== "copy" || (copyAnchor && copyPointAvailable)) return;
    const state = sceneRef.current;
    if (!state || (!state.preview.children.some((child) => child.visible)
      && state.previewHint.hidden && state.maatLabel.hidden)) return;
    hidePreview(state.preview);
    state.previewHint.hidden = true;
    state.maatLabel.hidden = true;
    state.renderer.render(state.scene, state.camera);
  }, [tool, copyAnchor, copyPointAvailable]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Een nieuwe scène heeft een nieuwe camera (op de iso-start): het
    // aanzichteffect richt hem dus opnieuw op het lintaanzicht, ook als het
    // token niet veranderde (React StrictMode bouwt de scène tweemaal op).
    aimedViewTokenRef.current = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const perspectiveCamera = new THREE.PerspectiveCamera(OPEN_FEM_3D_FOV_GRADEN, 1, 0.01, 100000);
    perspectiveCamera.up.set(0, 0, 1);
    perspectiveCamera.position.set(...openFem3DStartCamera().position);
    // De parallelle camera (zichtbaarheid `perspective` uit). Hij neemt bij
    // het wisselen doel, richting, up en zichtbare grootte over; zie
    // zetOpenFem3DProjectie en openFem3dProjectie.ts.
    const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1000);
    orthographicCamera.up.set(0, 0, 1);
    // De actieve camera. Alle handlers hieronder lezen hem via deze variabele;
    // alleen projectieRef (het wisselen) zet hem om, samen met sceneRef.
    let camera: OpenFem3DCamera = perspectiveCamera;
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
    // Het streep-stip van het stramien meet zijn pixels bij het draaipunt (#103).
    openFem3DStramienCameraDoel(scene, controls.target);

    const grid = new THREE.GridHelper(20, 20, 0xb6c2cf, 0xe2e8f0);
    // Three.js' raster ligt standaard in XZ. Het raamwerk gebruikt XY als
    // grondvlak, omdat Z net als in de bestaande 2D-editor omhoog wijst.
    grid.rotation.x = Math.PI / 2;
    // Oriëntatie: de section box (issue #86) knipt raster en assen niet.
    grid.userData.openFem3dNietKnippen = true;
    scene.add(grid);
    const axes = new THREE.AxesHelper(2);
    axes.userData.openFem3dNietKnippen = true;
    scene.add(axes);
    const axisLabels = [
      makeLabel("X", "open-fem3d-axis-label open-fem3d-axis-x", new THREE.Vector3(2.25, 0, 0)),
      makeLabel("Y", "open-fem3d-axis-label open-fem3d-axis-y", new THREE.Vector3(0, 2.25, 0)),
      makeLabel("Z", "open-fem3d-axis-label open-fem3d-axis-z", new THREE.Vector3(0, 0, 2.25)),
    ];
    axisLabels.forEach((label) => {
      label.userData.openFem3dNietKnippen = true;
      scene.add(label);
    });
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
    // Het tekenvoorbeeld (contour, rubberband, cursor, spoor) knipt de section box niet.
    draftLine.userData.openFem3dNietKnippen = true;
    scene.add(draftLine);
    const preview = new THREE.Group();
    preview.renderOrder = 100;
    preview.userData.openFem3dNietKnippen = true;
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
    // Objectspoor (#84): gestippelde spoorlijnen van het verworven punt tot
    // het tekenpunt, en een kruisje op elk verworven punt en elke verworven
    // staaf. In wereldmaat, zodat ze bij zoomen en draaien meegaan.
    const spoorGeometry = new THREE.BufferGeometry();
    spoorGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    spoorGeometry.setDrawRange(0, 0);
    const spoorLijnBeeld = new THREE.LineSegments(
      spoorGeometry,
      new THREE.LineDashedMaterial({ color: 0x16a34a, dashSize: 0.1, gapSize: 0.06, depthTest: false }),
    );
    spoorLijnBeeld.renderOrder = 101;
    spoorLijnBeeld.visible = false;
    preview.add(spoorLijnBeeld);
    const spoorKruisGeometry = new THREE.BufferGeometry();
    spoorKruisGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9 * 4 * 3), 3));
    spoorKruisGeometry.setDrawRange(0, 0);
    const spoorKruisBeeld = new THREE.LineSegments(
      spoorKruisGeometry,
      new THREE.LineBasicMaterial({ color: 0x16a34a, depthTest: false }),
    );
    spoorKruisBeeld.renderOrder = 102;
    spoorKruisBeeld.visible = false;
    preview.add(spoorKruisBeeld);
    const previewHint = document.createElement("span");
    previewHint.className = "open-fem3d-snap-hint";
    previewHint.hidden = true;
    container.appendChild(previewHint);
    const maatLabel = document.createElement("span");
    maatLabel.className = "open-fem3d-maat-label";
    maatLabel.hidden = true;
    container.appendChild(maatLabel);
    const selectionBox = document.createElement("div");
    selectionBox.className = "open-fem3d-selection-box";
    selectionBox.hidden = true;
    container.appendChild(selectionBox);
    scene.add(preview);
    // De bol waarbuiten de parallelle camera staat: knopen, raster, stramienen
    // en de X/Y/Z-assen, ruim vergroot voor profielen, lasten, diagrammen en
    // labels. Alleen opnieuw bij een andere knopenlijst, raster of stramien.
    let orthoBolBron: { nodes: unknown; rooster: unknown; assen: unknown } | null = null;
    let orthoBolWaarde = { middelpunt: new THREE.Vector3(), straal: 1 };
    const orthoBol = () => {
      const nodes = modelRef.current.nodes;
      const rooster = sceneRef.current?.grid ?? grid;
      const assen = structuralSnapAxesRef.current;
      if (orthoBolBron?.nodes === nodes && orthoBolBron.rooster === rooster && orthoBolBron.assen === assen) return orthoBolWaarde;
      const box = openFem3DNodeBounds(modelRef.current);
      box.union(new THREE.Box3().setFromObject(rooster));
      box.expandByPoint(new THREE.Vector3(-0.5, -0.5, -0.5)).expandByPoint(new THREE.Vector3(2.5, 2.5, 2.5));
      for (const as of ["x", "y", "z"] as const) {
        const waarden = assen[as];
        if (waarden.length === 0) continue;
        box.min[as] = Math.min(box.min[as], waarden[0]);
        box.max[as] = Math.max(box.max[as], waarden[waarden.length - 1]);
      }
      box.expandByScalar(Math.max(3, 0.25 * box.getSize(new THREE.Vector3()).length()));
      const bol = box.getBoundingSphere(new THREE.Sphere());
      orthoBolBron = { nodes, rooster, assen };
      orthoBolWaarde = { middelpunt: bol.center, straal: bol.radius };
      return orthoBolWaarde;
    };
    // De section box (issue #86): zes gedeelde clipping planes, randen en
    // grepen. Vóór elke render krijgen de materialen van het model de vlakken
    // (alleen wat nog niet klopt; de doos zelf en de oriëntatie niet) en
    // staan de grepen op hun vaste schermmaat.
    const sectionBoxBeeld = createOpenFem3DSectionBoxBeeld();
    scene.add(sectionBoxBeeld.group);
    sceneRef.current = {
      scene, camera, perspectiveCamera, orthographicCamera, orthoBol,
      renderer, labelRenderer, controls, geometry, draftLine, preview, previewHint, maatLabel, grid, axes, axisLabels, viewCube: null,
      levelMarks: null,
      sectionBox: null, sectionBoxBeeld, sectionBoxKnipt: { materialen: false, labels: false },
    };
    scene.onBeforeRender = () => {
      const state = sceneRef.current;
      if (!state) return;
      const vlakken = state.sectionBox ? sectionBoxBeeld.vlakken : null;
      if (vlakken || state.sectionBoxKnipt.materialen) {
        const startedAt = performance.now();
        const aantal = openFem3DSectionBoxKnipMaterialen(scene, vlakken);
        state.sectionBoxKnipt.materialen = vlakken !== null;
        container.dataset.openFem3dSectionBoxMaterialen = vlakken ? String(aantal) : "0";
        container.dataset.openFem3dSectionBoxSyncMs = (performance.now() - startedAt).toFixed(3);
      }
      if (state.sectionBox) sectionBoxBeeld.schaal(state.camera, renderer.domElement.clientHeight);
    };

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
      // In parallelle projectie met de exacte schaal (orthoHalfHeight).
      cameraChangeRef.current?.(openFem3DCameraStateVan(sceneRef.current!));
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
      // Spoorlijnen, kruisjes en labels van de tekenhulp (#84) bij de nieuwe camerastand.
      verversVoorbeeld();
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
    // Parallel: na elke draai- of panstap de camera weer ver genoeg terug
    // (een draai om een ver weggeschoven doel kan het model anders achter de
    // camera brengen). Het beeld verandert daar niet door.
    const houdOrthoCameraVrij = () => {
      if (sceneRef.current && isOpenFem3DOrtho(camera)) plaatsOrthoCamera(sceneRef.current);
    };
    controls.addEventListener("start", startCameraInteraction);
    controls.addEventListener("change", followOrbitPivot);
    controls.addEventListener("change", houdOrthoCameraVrij);
    controls.addEventListener("change", renderCameraInteraction);
    // Camera-instellingen gaan pas na de interactie naar React. Tijdens
    // pannen/roteren hoeft daardoor geen componentstate per muispixel mee.
    controls.addEventListener("end", endControlsInteraction);

    // View cube (issue #85): een klik zet de camera in de richting van het
    // vlak, de ribbe of de hoek, met dezelfde passende afstand als het lint;
    // slepen draait om het doel. Daarna opslaan en het aanzicht melden zoals
    // na een draai met de muis (endCameraInteraction).
    const cameraViaKubus = (richt: (state: SceneState) => void, bron: string) => {
      const state = sceneRef.current;
      if (!state) return;
      const withinInteraction = cameraInteractionActive;
      startCameraInteraction();
      richt(state);
      if (!withinInteraction) endCameraInteraction();
      container.dataset.openFem3dViewCubeDoel = bron;
    };
    const cameraNaarRichting = (richting: Vec3, up: Vec3, bron: string) => cameraViaKubus(
      (state) => aimOpenFem3DCamera(state, modelRef.current, visibilityRef.current, richting, up), bron,
    );
    // Het menu ▾: Startaanzicht (iso met passend beeld), Passend beeld (de
    // huidige richting, zoals de knop) en Perspectief: een schakelaar
    // (menuitemcheckbox) op de zichtbaarheid `perspective`. De aanroeper zet
    // de zichtbaarheid om; het effect op `visibility.perspective` wisselt de
    // camera en zet het vinkje bij. Daaronder de section box (issue #86):
    // aan/uit (een schakelaar), passend op de selectie (zonder selectie
    // uitgeschakeld) en terug op de modelgrenzen. De aanroeper zet de doos in
    // de zichtbaarheid; het effect op `visibility.sectionBox` past hem toe.
    const zetSectionBox = (volgende: OpenFem3DSectionBox | null) => {
      if (volgende) sectionBoxChangeRef.current?.(volgende);
    };
    viewCubeMenuRef.current = (teksten) => [
      {
        id: "start", tekst: teksten.start,
        kies: () => {
          const { richting, up } = openFem3DAanzichtRichting("iso");
          cameraNaarRichting(richting, up, "start");
        },
      },
      {
        id: "passend", tekst: teksten.passend,
        kies: () => cameraViaKubus((state) => fitOpenFem3DCamera(state, modelRef.current, visibilityRef.current), "passend"),
      },
      {
        id: "perspectief", tekst: teksten.perspectief, rol: "menuitemcheckbox", aan: visibilityRef.current.perspective,
        kies: () => perspectiveChangeRef.current?.(!visibilityRef.current.perspective),
      },
      {
        id: "explode", tekst: teksten.explode, rol: "menuitemcheckbox", scheiding: true,
        aan: visibilityRef.current.explode.amountM > 0,
        kies: () => explodeChangeRef.current?.(toggleOpenFem3DExplode(visibilityRef.current.explode).amountM),
      },
      {
        id: "sectionBox", tekst: teksten.sectionBox, rol: "menuitemcheckbox", scheiding: true,
        aan: visibilityRef.current.sectionBox?.enabled === true,
        kies: () => zetSectionBox(openFem3DSectionBoxSchakel(
          visibilityRef.current.sectionBox ?? DEFAULT_OPEN_FEM_3D_SECTION_BOX, modelRef.current)),
      },
      {
        id: "sectionBoxSelectie", tekst: teksten.sectionBoxSelectie, uitgeschakeld: selectionRef.current === null,
        kies: () => zetSectionBox(openFem3DSectionBoxOpSelectie(modelRef.current, selectionRef.current)),
      },
      {
        id: "sectionBoxReset", tekst: teksten.sectionBoxReset,
        kies: () => zetSectionBox(openFem3DSectionBoxReset(modelRef.current)),
      },
    ];
    const viewCube = createOpenFem3DViewCube(container, viewCubeTekstenRef.current, {
      kies: (doel) => cameraNaarRichting(doel.richting, doel.up, doel.id),
      sleepStart: startCameraInteraction,
      sleep: (dxPx, dyPx) => {
        // Zoals rechts slepen in het tekenvlak: azimut om wereld-Z en een
        // begrensde elevatie, om het doel. Daarna staat Z weer omhoog.
        const { dAzimut, dElevatie } = openFem3DViewCubeSleepHoeken(dxPx, dyPx, renderer.domElement.clientHeight);
        const offset = camera.position.clone().sub(controls.target);
        const boven = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const [x, y, z] = openFem3DViewCubeDraai(
          [offset.x, offset.y, offset.z], [boven.x, boven.y, boven.z], dAzimut, dElevatie,
        );
        camera.up.set(0, 0, 1);
        camera.position.set(controls.target.x + x, controls.target.y + y, controls.target.z + z);
        controls.update();
      },
      sleepEinde: endCameraInteraction,
      // Het open menu is gereserveerd gebied: labels eronder opnieuw indelen.
      menuWissel: () => {
        if (sceneRef.current && !cameraInteractionActive) renderOpenFem3DLabels(sceneRef.current, container);
      },
    }, viewCubeMenuRef.current(viewCubeTekstenRef.current));
    viewCube.toon(visibilityRef.current.viewCube);
    sceneRef.current.viewCube = viewCube;

    // Perspectief of parallel (zichtbaarheid `perspective`): wissel de camera
    // (doel, richting, up en zichtbare grootte blijven), teken en bewaar hem
    // zoals na een camera-interactie. Het aanzicht verandert niet.
    projectieRef.current = (perspectief) => {
      const state = sceneRef.current;
      if (!state || !zetOpenFem3DProjectie(state, perspectief)) return;
      camera = state.camera;
      orbitPivot = null;
      nodeSnapScreenIndexDirtyRef.current = true;
      renderScene();
      saveCamera();
      nodeSnapPrewarmRef.current?.();
    };

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      // Beide camera's: de niet-actieve neemt bij het wisselen deze verhouding over.
      perspectiveCamera.aspect = width / height;
      perspectiveCamera.updateProjectionMatrix();
      openFem3DZetOrthoFrustum(orthographicCamera, openFem3DOrthoHalveHoogteVan(orthographicCamera), width / height);
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
    // Een eigen straal door een knoop (plaatsen met snap): of iets hem afdekt.
    const nodeRaycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const setPointer = (event: { clientX: number; clientY: number }) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
                  -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      // Three.js gebruikt anders een vaste wereldafstand van 1 m voor lijnen.
      // Dat selecteert op een uitgezoomd raamwerk een last ver naast de cursor
      // en kan een naburige staaf overstemmen. Houd circa vijf schermpixels aan
      // (bij het doel; in perspectief en parallel dezelfde maat).
      const worldPerPixel = openFem3DWereldmaatPerPixel(camera, controls.target, rect.height);
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
      // Buiten de section box (issue #86) is niets getekend: geen anker.
      const hit = binnenDoos(raycaster.intersectObjects(visibleTargets, false))[0];
      // Het zoomanker ligt op de cursorstraal, zodat het punt onder de muis
      // blijft staan; zie openFem3dWheelAnchor.ts voor de keuze van de diepte.
      const { point: anchor, source: anchorSource } = wheelAnchor(
        raycaster.ray, hit?.point ?? null, openFem3DNodeBounds(modelRef.current),
        camera.getWorldDirection(new THREE.Vector3()), controls.target,
      );
      const modeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const delta = event.deltaY * modeScale * (event.ctrlKey ? 10 : 1);
      const step = Math.pow(0.95, controls.zoomSpeed * Math.abs(delta * 0.01));
      // De zoommaat: in perspectief de afstand tot het doel, in parallel de
      // perspectiefafstand die bij de halve hoogte hoort; dezelfde grenzen.
      const ortho = isOpenFem3DOrtho(camera) ? camera : null;
      const distance = ortho
        ? openFem3DPerspectiefAfstand(openFem3DOrthoHalveHoogteVan(ortho), perspectiveCamera.fov)
        : camera.position.distanceTo(controls.target);
      const nextDistance = THREE.MathUtils.clamp(
        distance * (delta < 0 ? step : 1 / step),
        Math.max(controls.minDistance, 0.1), controls.maxDistance,
      );
      const scale = nextDistance / distance;
      // Een wielstap tijdens het draaien hoort bij die interactie; die sluit
      // zelf af bij het loslaten van de muisknop.
      const withinInteraction = cameraInteractionActive;
      startCameraInteraction();
      if (ortho) {
        // Parallel: de halve hoogte schaalt, het doel schuift naar het anker
        // toe; de camera staat daarna weer op zijn plek achter het doel.
        const stap = openFem3DOrthoWielStap(controls.target, anchor, openFem3DOrthoHalveHoogteVan(ortho), scale);
        const verschuiving = stap.doel.clone().sub(controls.target);
        controls.target.copy(stap.doel);
        ortho.position.add(verschuiving);
        openFem3DZetOrthoFrustum(ortho, stap.halveHoogte, perspectiveCamera.aspect);
        plaatsOrthoCamera(sceneRef.current!);
      } else {
        camera.position.sub(anchor).multiplyScalar(scale).add(anchor);
        controls.target.sub(anchor).multiplyScalar(scale).add(anchor);
      }
      controls.update();
      // Parallel met het anker precies op het doel verschuift er niets: dan
      // meldt de besturing geen wijziging, maar het frustum is wel anders.
      if (ortho) renderCameraInteraction();
      if (!withinInteraction) endCameraInteraction();
      container.dataset.openFem3dWheelAnchor = anchorSource;
      container.dataset.openFem3dWheelMs = (performance.now() - startedAt).toFixed(2);
    };
    renderer.domElement.addEventListener("wheel", onWheelAnchor, { capture: true, passive: false });
    // Pannen met de scrollknop: het punt onder de cursor gaat één op één met
    // de muis mee. OrbitControls pant in het vlak door zijn doel; lag dat
    // dichter bij de camera dan het model, dan bleef het model achter de muis.
    // Dezelfde diepte als het zoomanker, zodat zoomen en pannen gelijk voelen.
    const onPanStart = (event: PointerEvent) => {
      if (event.button !== 1 || !controls.enabled || !controls.enablePan) return;
      if (isOpenFem3DOrtho(camera)) {
        // Parallel: elk punt, op welke diepte ook, schuift evenveel als het
        // vlak door het doel; OrbitControls pant al één op één met het frustum.
        controls.panSpeed = 1;
        container.dataset.openFem3dPanSpeed = controls.panSpeed.toFixed(3);
        return;
      }
      setPointer(event);
      const visibleTargets = [...nodePickTargetsRef.current, ...nonNodePickTargetsRef.current]
        .filter((target) => target.userData.pickable !== false);
      const hit = binnenDoos(raycaster.intersectObjects(visibleTargets, false))[0];
      const view = camera.getWorldDirection(new THREE.Vector3());
      const { point } = wheelAnchor(
        raycaster.ray, hit?.point ?? null, openFem3DNodeBounds(modelRef.current), view, controls.target,
      );
      const depth = point.clone().sub(camera.position).dot(view);
      const targetDepth = controls.target.clone().sub(camera.position).dot(view);
      controls.panSpeed = depth > 0 && targetDepth > 0 ? THREE.MathUtils.clamp(depth / targetDepth, 0.05, 50) : 1;
      container.dataset.openFem3dPanSpeed = controls.panSpeed.toFixed(3);
    };
    renderer.domElement.addEventListener("pointerdown", onPanStart, { capture: true });

    // ── Section box (issue #86) ───────────────────────────────────────────
    // Toepassen: vlakken, randen en grepen, en wat kiezen en snappen zien (de
    // schermindex van de knopen, het objectspoor). Ook voor een doos van
    // buiten (menu, lint, view, bedieningskanaal): het effect op
    // `visibility.sectionBox` roept sectionBoxToepassenRef aan.
    let greepSleep: {
      pointerId: number; vlak: OpenFem3DSectionBoxVlak; begin: OpenFem3DSectionBoxBounds;
      beginWaarde: number; s0: number; oorsprong: THREE.Vector3; richting: THREE.Vector3;
    } | null = null;
    let greepHover: string | null = null;
    let sleepStappen = 0;
    const toonSectionBox = (bounds: OpenFem3DSectionBoxBounds | null) => {
      const state = sceneRef.current;
      if (!state) return;
      state.sectionBox = bounds;
      state.sectionBoxBeeld.zet(bounds);
      // Lokale clipping alleen met een doos: zonder doos geen extra werk per object.
      renderer.localClippingEnabled = bounds !== null;
      nodeSnapScreenIndexDirtyRef.current = true;
      container.dataset.openFem3dSectionBox = bounds ? `${bounds.min.join(",")};${bounds.max.join(",")}` : "uit";
      if (bounds) spoorBinnenDoos(bounds);
    };
    /**
     * Het objectspoor (#84): wat buiten de doos valt, is niet meer verworven.
     * Bij elke doos die getoond wordt, ook bij elke sleepstap: na het loslaten
     * komt dezelfde doos via de zichtbaarheid terug, en die slaat het toepassen
     * dan over (gelijke grenzen). Alleen als er iets wegvalt, het voorbeeld opnieuw.
     */
    const spoorBinnenDoos = (bounds: OpenFem3DSectionBoxBounds) => {
      const voor = spoorVerworvenRef.current;
      const na = voor.filter((item) => item.soort === "knoop"
        ? openFem3DSectionBoxBevat(bounds, item.punt)
        : openFem3DSectionBoxKnipLijnstuk(bounds, item.a, item.b) !== null);
      if (na.length === voor.length) return;
      spoorVerworvenRef.current = na;
      container.dataset.openFem3dSpoorVerworven = na.map((i) => `${i.soort}:${i.id}`).join(",");
      verversVoorbeeld();
    };
    /** De greep onder de muis (in schermpixels), met de grepen op de maat van deze camerastand. */
    const greepOnderMuis = (event: { clientX: number; clientY: number }) => {
      const state = sceneRef.current;
      if (!state?.sectionBox) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      state.sectionBoxBeeld.schaal(camera, rect.height);
      return state.sectionBoxBeeld.greepOnder(camera, rect.width, rect.height, event.clientX - rect.left, event.clientY - rect.top);
    };
    const markeerGreep = (id: string | null) => {
      if (id === greepHover) return;
      greepHover = id;
      sceneRef.current?.sectionBoxBeeld.markeer(id);
      renderer.domElement.style.cursor = greepSleep ? "grabbing" : id ? "grab" : "";
      container.dataset.openFem3dSectionBoxGreep = id ?? "";
      renderCameraInteraction();
    };
    /**
     * Klaar met slepen: labels terug, alles opnieuw getekend, en de nieuwe
     * doos (bij `bewaar`) naar de aanroeper, die hem in de zichtbaarheid zet.
     */
    const eindigGreepSleep = (bewaar: boolean) => {
      const sleep = greepSleep;
      if (!sleep) return;
      greepSleep = null;
      try {
        if (renderer.domElement.hasPointerCapture(sleep.pointerId)) renderer.domElement.releasePointerCapture(sleep.pointerId);
      } catch { /* geen actieve aanwijzer (synthetisch) */ }
      labelRenderer.domElement.style.visibility = "visible";
      container.dataset.openFem3dLabelsSuspended = "false";
      delete container.dataset.openFem3dSectionBoxSleept;
      greepHover = "";
      markeerGreep(null);
      renderScene();
      const bounds = sceneRef.current?.sectionBox ?? null;
      if (bewaar && bounds && !openFem3DSectionBoxGelijk(bounds, sleep.begin)) {
        sectionBoxChangeRef.current?.({ enabled: true, bounds });
      }
      nodeSnapPrewarmRef.current?.();
    };
    sectionBoxToepassenRef.current = (box) => {
      const bounds = openFem3DSectionBoxActief(box);
      // Een doos van buiten breekt een lopende sleep af (zonder hem te bewaren).
      if (greepSleep) eindigGreepSleep(false);
      if (openFem3DSectionBoxGelijk(bounds, sceneRef.current?.sectionBox)) return;
      // Ook het objectspoor (#84) volgt de doos: zie spoorBinnenDoos.
      toonSectionBox(bounds);
      nodeSnapPrewarmRef.current?.();
    };
    // Een greep slepen (links): het vlak schuift langs zijn normaal, naar het
    // punt op de as dat het dichtst bij de muisstraal ligt. Alleen de vlakken
    // (uniforms), de randen en de grepen veranderen: geen opbouw van de scène,
    // en de camera draait niet mee (de klik bereikt de besturing niet). Vóór
    // kiezen, kader en besturing: in de vangfase, met stopImmediatePropagation.
    const onGreepDown = (event: PointerEvent) => {
      const state = sceneRef.current;
      if (event.button !== 0 || !state?.sectionBox) return;
      const vlak = greepOnderMuis(event);
      if (!vlak) return;
      const begin = state.sectionBox;
      const [x, y, z] = openFem3DSectionBoxVlakMidden(begin, vlak);
      const oorsprong = new THREE.Vector3(x, y, z);
      const richting = new THREE.Vector3().setComponent(vlak.as, 1);
      setPointer(event);
      const s0 = openFem3DSectionBoxAsParameter(oorsprong, richting, raycaster.ray.origin, raycaster.ray.direction);
      // Kijk je langs de as, dan wijst de greep naar je toe: niet te slepen.
      // De klik gaat dan gewoon door naar kiezen, kader en besturing (geen
      // dode plek midden in de doos); pas een echte sleep houdt hem tegen.
      if (s0 === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      greepSleep = {
        pointerId: event.pointerId, vlak, begin, beginWaarde: openFem3DSectionBoxVlakWaarde(begin, vlak), s0, oorsprong, richting,
      };
      sleepStappen = 0;
      try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* synthetisch */ }
      // Zoals bij een camera-interactie wachten de labels tot het loslaten.
      labelRenderer.domElement.style.visibility = "hidden";
      container.dataset.openFem3dLabelsSuspended = "true";
      container.dataset.openFem3dSectionBoxSleept = vlak.id;
      greepHover = "";
      markeerGreep(vlak.id);
    };
    const onGreepMove = (event: PointerEvent) => {
      if (!greepSleep) {
        // Boven een greep: een handje en de greep donkerder (alleen bij een wissel een render).
        if (sceneRef.current?.sectionBox && event.buttons === 0) markeerGreep(greepOnderMuis(event)?.id ?? null);
        else if (greepHover) markeerGreep(null);
        return;
      }
      if (event.pointerId !== greepSleep.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPointer(event);
      const s = openFem3DSectionBoxAsParameter(greepSleep.oorsprong, greepSleep.richting, raycaster.ray.origin, raycaster.ray.direction);
      if (s === null) return;
      const volgende = openFem3DSectionBoxZetVlak(greepSleep.begin, greepSleep.vlak, greepSleep.beginWaarde + s - greepSleep.s0);
      if (openFem3DSectionBoxGelijk(volgende, sceneRef.current?.sectionBox)) return;
      const startedAt = performance.now();
      toonSectionBox(volgende);
      sleepStappen += 1;
      container.dataset.openFem3dSectionBoxSleepstappen = String(sleepStappen);
      container.dataset.openFem3dSectionBoxStapMs = (performance.now() - startedAt).toFixed(3);
      renderCameraInteraction();
    };
    const onGreepUp = (event: PointerEvent) => {
      if (!greepSleep || event.pointerId !== greepSleep.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      eindigGreepSleep(true);
    };
    // Esc tijdens het slepen: de doos terug op de modelgrenzen (plus marge),
    // zoals Reset in het menu. Vóór de Esc van gereedschap en selectie.
    const onGreepToets = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !greepSleep) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      eindigGreepSleep(false);
      const reset = openFem3DSectionBoxReset(modelRef.current);
      toonSectionBox(openFem3DSectionBoxActief(reset));
      renderScene();
      sectionBoxChangeRef.current?.(reset);
      container.dataset.openFem3dEscape = "sectionBoxReset";
    };
    renderer.domElement.addEventListener("pointerdown", onGreepDown, { capture: true });
    renderer.domElement.addEventListener("pointermove", onGreepMove, { capture: true });
    renderer.domElement.addEventListener("pointerup", onGreepUp, { capture: true });
    renderer.domElement.addEventListener("pointercancel", onGreepUp, { capture: true });
    window.addEventListener("keydown", onGreepToets);
    /** Alleen treffers binnen de section box: wat buiten ligt, is niet getekend. */
    const binnenDoos = <T extends { point: THREE.Vector3 }>(treffers: T[]): T[] => {
      const doos = sceneRef.current?.sectionBox;
      return doos ? treffers.filter((treffer) => openFem3DSectionBoxBevat(doos, treffer.point)) : treffers;
    };
    /** Lijnstukken (lastpijlen) geknipt op de section box. */
    const knipOpDoos = <T extends { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }>(delen: readonly T[]): readonly T[] => {
      const doos = sceneRef.current?.sectionBox;
      if (!doos) return delen;
      return delen.flatMap((deel) => {
        const binnen = openFem3DSectionBoxKnipLijnstuk(doos, deel.a, deel.b);
        return binnen ? [{ ...deel, a: binnen.a, b: binnen.b }] : [];
      });
    };
    const drawingAnchor = () => {
      if (toolRef.current === "copy") {
        return copyAnchorRef.current ? { ...copyAnchorRef.current, id: -1 } : undefined;
      }
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
    type DrawingSnap = {
      position: THREE.Vector3; nodeId?: number; plane?: THREE.Plane;
      /** De snap of tekenhulp die het punt gaf; "invoer" is een getypte maat (#84). */
      kind?: SnapSoort | "spoor" | "ortho" | "invoer";
      /** De keuze van de tekenhulp (#84): soort, spoorlijnen en de tekst bij de cursor. */
      tekenpunt?: Tekenpunt;
      /** Het werkvlak van die keuze (#84), voor het snijpunt van een spoorlijn met een geraakte staaf. */
      vlak?: Werkvlak;
    };
    /**
     * Het punt van een getypte maat (#84) tijdens de klik die hem plaatst:
     * drawingSnap geeft dan precies dit punt, zonder snap.
     */
    let geforceerdPunt: { position: THREE.Vector3; plane?: THREE.Plane } | null = null;
    /** Shift: de ortho-as van de vorige muisstand bij dit beginpunt (hysterese). */
    let orthoVorige: { startId: number; as: As3 } | null = null;
    /** De normaal van het laatst gebruikte werkvlak, voor de richting in het maatlabel (#84). */
    const laatsteNormaal = new THREE.Vector3(0, 0, 1);
    /** Het beginpunt van de staaf of contour in aanbouw (#84): de beginknoop of de laatste contourknoop. */
    const tekenStart = () => {
      const tool = toolRef.current;
      const sketch = isOpeningTool(tool) ? openingDraftRef.current : plateDraftRef.current;
      const id = tool === "addBeam" ? beamStartRef.current
        : isPlateSketchTool(tool) || isOpeningTool(tool) ? sketch.lastNodeId : null;
      return (id === null ? undefined : nodeByIdRef.current!.get(id)) ?? null;
    };
    /**
     * Een getypte maat (#84) hoort bij het beginpunt waarbij hij getypt is.
     * Zoals in 2D wist elke klik die een punt zet hem (klikOpTekenvlak), en
     * een ander of geen beginpunt ook (ongedaan maken, Esc, een ander
     * gereedschap): anders gold een oude maat voor het volgende segment.
     */
    let maatStart: number | null = null;
    const wisMaat = () => {
      maatInvoerRef.current = null;
      maatStart = null;
      container.dataset.openFem3dMaatInvoer = "";
    };
    const geldigeMaat = () => {
      if (maatInvoerRef.current !== null && (tekenStart()?.id ?? null) !== maatStart) wisMaat();
      return maatInvoerRef.current;
    };
    /** Wereldpunt naar schermpixels van het tekenvlak, met één gecombineerde matrix; null achter de camera. */
    const schermProjectie = () => {
      const width = Math.max(1, renderer.domElement.clientWidth);
      const height = Math.max(1, renderer.domElement.clientHeight);
      camera.updateMatrixWorld();
      const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
      return (p: Punt3) => {
        const cx = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
        const cy = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
        const cw = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
        if (!(cw > 1e-12)) return null;
        return { x: (cx / cw + 1) * width / 2, y: (1 - cy / cw) * height / 2 };
      };
    };
    const alsPunt = (v: { x: number; y: number; z: number }): Punt3 => ({ x: v.x, y: v.y, z: v.z });
    const ensureNodeSnapScreenIndex = () => {
      const width = Math.max(1, renderer.domElement.clientWidth);
      const height = Math.max(1, renderer.domElement.clientHeight);
      const current = nodeSnapScreenIndexRef.current;
      if (nodeSnapScreenIndexDirtyRef.current || !current || current.width !== width || current.height !== height
        || current.nodeCount !== modelRef.current.nodes.length) {
        camera.updateMatrixWorld();
        // Kiezen, snappen en verwerven op een knoop: alleen binnen de section
        // box (issue #86). De index telt (nodeCount) het hele model, zodat een
        // gewijzigd model hem nog steeds ververst.
        const doos = sceneRef.current?.sectionBox;
        const knopen = doos
          ? modelRef.current.nodes.filter((node) => openFem3DSectionBoxBevat(doos, node))
          : modelRef.current.nodes;
        nodeSnapScreenIndexRef.current = {
          ...buildOpenFem3DNodeSnapScreenIndex(knopen, camera, width, height),
          nodeCount: modelRef.current.nodes.length,
        };
        nodeSnapScreenIndexDirtyRef.current = false;
        container.dataset.openFem3dNodeSnapIndexed = String(knopen.length);
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
        container.dataset.openFem3dTekenpunt = value ? value.tekenpunt?.soort ?? value.kind ?? "vrij" : "none";
        return value;
      };
      delete container.dataset.openFem3dSnapCandidates;
      // Een getypte maat (#84): het punt ligt vast, zonder snap.
      if (geforceerdPunt) return finish({ position: geforceerdPunt.position.clone(), kind: "invoer", plane: geforceerdPunt.plane?.clone() });
      // Tekenhulpen (#84) bij knoop, staaf, omtrek en opening: Alt zet alle
      // snaps tijdelijk uit, Shift (met een beginpunt) is ortho.
      const toetsen = tekenToetsenRef.current;
      const hulp = isTekenhulpTool(toolRef.current);
      const settings = toetsen.alt
        ? { ...snapsRef.current, knoop: false, stramien: false, raster: false, spoor: false }
        : snapsRef.current;
      const start = hulp ? tekenStart() : null;
      const ortho = hulp && toetsen.shift && start !== null && !isArcBoundaryTool(toolRef.current);
      let knoopKandidaat: { id: number; punt: Punt3 } | null = null;
      let stramienKandidaat: { punt: THREE.Vector3; assen: readonly As3[] } | null = null;
      let rasterKandidaat: THREE.Vector3 | null = null;
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
          // Met Shift (ortho) geeft de knoop alleen de maat langs de as.
          if (node && !ortho) return finish({ position: new THREE.Vector3(node.x, node.y, node.z), nodeId: node.id, kind: "knoop" });
          if (node) knoopKandidaat = { id: node.id, punt: { x: node.x, y: node.y, z: node.z } };
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
        pointedPlatePlane = platePlaneFromHit(binnenDoos(raycaster.intersectObjects(plateTargets, false))[0]);
      }
      const { view, origin, plane, surfaceConstrained } = openingPlane ?? drawingPlane(nearPlateNodeId, pointedPlatePlane);
      laatsteNormaal.copy(plane.normal);
      const position = new THREE.Vector3();
      // Parallel de hele lijn: een werkvlakpunt achter het cameravlak hoort
      // gewoon bij deze pixel (openFem3DStraalOpVlak).
      if (!openFem3DStraalOpVlak(camera, raycaster.ray, plane, position)) return finish(null);
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
        // Een stramienpunt buiten de section box (issue #86) vangt niet.
        const doos = sceneRef.current?.sectionBox;
        const nearest = candidates.reduce<{ point: THREE.Vector3; axes: readonly ("x" | "y" | "z")[]; distance: number } | null>((best, candidate) => {
          if (doos && !openFem3DSectionBoxBevat(doos, candidate.point)) return best;
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
          if (!hulp) return finish({ position: onDrawingPlane(nearest.point), kind: "stramien",
            plane: toolRef.current === "addBeam" ? plane.clone() : undefined });
          stramienKandidaat = { punt: onDrawingPlane(nearest.point), assen: nearest.axes };
        }
      }
      if (settings.raster) {
        const spacing = Math.max(0.001, gridSpacingRef.current);
        const round = (value: number) => Math.round(value / spacing) * spacing;
        if (view === "front") position.set(round(raw.x), origin.y, round(raw.z));
        else if (view === "side") position.set(origin.x, round(raw.y), round(raw.z));
        else position.set(round(raw.x), round(raw.y), origin.z);
        if (!hulp) return finish({ position: onDrawingPlane(position), kind: "raster",
          plane: toolRef.current === "addBeam" ? plane.clone() : undefined });
        rasterKandidaat = onDrawingPlane(position.clone());
      }
      if (!hulp) return finish({ position: raw, plane: toolRef.current === "addBeam" ? plane.clone() : undefined });
      // Tekenhulpen (#84): objectspoor en ortho tussen knoop en stramien in;
      // de voorrang staat in kiesTekenpunt (openFem3dTekenhulp.ts).
      const naarScherm = schermProjectie();
      const hoogte = Math.max(1, renderer.domElement.clientHeight);
      const vlak: Werkvlak = { punt: alsPunt(origin), normaal: alsPunt(plane.normal) };
      const keuze = kiesTekenpunt({
        cursor: alsPunt(raw),
        cursorPx: { x: (pointer.x + 1) * Math.max(1, renderer.domElement.clientWidth) / 2, y: (1 - pointer.y) * hoogte / 2 },
        naarScherm,
        vlak,
        start: start ? { punt: { x: start.x, y: start.y, z: start.z }, knoopId: start.id } : null,
        verworven: spoorVerworvenRef.current,
        instellingen: settings,
        toetsen: { alt: toetsen.alt, shift: ortho },
        knoop: knoopKandidaat,
        stramien: stramienKandidaat ? { punt: alsPunt(stramienKandidaat.punt), assen: stramienKandidaat.assen } : null,
        raster: rasterKandidaat ? alsPunt(rasterKandidaat) : null,
        rasterStap: settings.raster ? Math.max(0.001, gridSpacingRef.current) : null,
        vorigeOrthoAs: start && orthoVorige?.startId === start.id ? orthoVorige.as : null,
        orthoWisselMin: ORTHO_WISSEL_MIN_PX * openFem3DWereldmaatPerPixel(camera, controls.target, hoogte),
      });
      orthoVorige = start && keuze.orthoAs ? { startId: start.id, as: keuze.orthoAs } : null;
      const kind: DrawingSnap["kind"] = keuze.soort === "knoop" || keuze.soort === "stramien" || keuze.soort === "raster"
        ? keuze.soort
        : keuze.soort === "ortho" ? "ortho" : keuze.soort === "vrij" ? undefined : "spoor";
      return finish({
        position: onDrawingPlane(new THREE.Vector3(keuze.punt.x, keuze.punt.y, keuze.punt.z)),
        nodeId: keuze.soort === "knoop" ? keuze.knoopId : undefined,
        kind, tekenpunt: keuze, vlak,
        plane: toolRef.current === "addBeam" ? plane.clone() : undefined,
      });
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
    type WijzerStand = { clientX: number; clientY: number; buttons: number };
    let latestPointerEvent: WijzerStand | null = null;
    /**
     * De laatste muisstand boven het tekenvlak (#84): om het voorbeeld opnieuw
     * te tekenen na Alt of Shift, een verworven punt, een getypte maat of een
     * zoomstap, ook als de muis stilstaat.
     */
    let laatsteWijzer: WijzerStand | null = null;
    /** De tekst bij de cursor: welk spoor of welke snap het punt gaf (#84). */
    const hintTekst = (target: DrawingSnap): string | null => {
      if (target.tekenpunt) return tekenpuntTekst(target.tekenpunt, spoorVertaalRef.current, taalRef.current);
      if (target.kind === "knoop" || target.kind === "stramien" || target.kind === "raster") {
        return spoorVertaalRef.current(`common:snap.${target.kind}`);
      }
      return null;
    };
    /**
     * Kopiëren met basispunt en doelpunt: de editor geeft `onCopyPoint` alleen
     * mee bij het gereedschap Kopiëren met een kopieerbare selectie (knopen,
     * staven, platen, schilpanelen; niet in de explodeweergave). Dan is elke
     * gewone klik een punt en geen selectie; met Shift, Ctrl of Cmd blijft een
     * klik de selectie aanvullen (klikOpTekenvlak).
     */
    const isPointCopy = () => toolRef.current === "copy" && !!copyPointRef.current;
    /**
     * Objectspoor in beeld (#84): de spoorlijnen gestippeld van hun oorsprong
     * tot iets voorbij het tekenpunt, en een kruisje op elk verworven punt (op
     * een verworven staaf in het midden). Maten in schermpixels, omgerekend
     * naar wereldmaat bij het doel van de camera.
     */
    const tekenSpoor = (target: DrawingSnap | null, eind: THREE.Vector3 | null) => {
      const wereldPerPixel = openFem3DWereldmaatPerPixel(camera, controls.target, Math.max(1, renderer.domElement.clientHeight));
      const lijnPositie = spoorGeometry.getAttribute("position") as THREE.BufferAttribute;
      let n = 0;
      for (const lijn of target?.tekenpunt?.lijnen ?? []) {
        if (!eind || n + 2 > lijnPositie.count) break;
        const van = new THREE.Vector3(lijn.oorsprong.x, lijn.oorsprong.y, lijn.oorsprong.z);
        const richting = eind.clone().sub(van);
        if (richting.lengthSq() < 1e-18) richting.set(lijn.richting.x, lijn.richting.y, lijn.richting.z);
        const tot = eind.clone().addScaledVector(richting.normalize(), 60 * wereldPerPixel);
        lijnPositie.setXYZ(n++, van.x, van.y, van.z);
        lijnPositie.setXYZ(n++, tot.x, tot.y, tot.z);
      }
      lijnPositie.needsUpdate = true;
      spoorGeometry.setDrawRange(0, n);
      const streep = spoorLijnBeeld.material as THREE.LineDashedMaterial;
      streep.dashSize = 6 * wereldPerPixel;
      streep.gapSize = 4 * wereldPerPixel;
      spoorLijnBeeld.computeLineDistances();
      spoorLijnBeeld.visible = n > 0;
      const kruisPositie = spoorKruisGeometry.getAttribute("position") as THREE.BufferAttribute;
      let k = 0;
      if (snapsRef.current.spoor && !tekenToetsenRef.current.alt) {
        camera.updateMatrixWorld();
        const rechts = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        const boven = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        const maat = 5 * wereldPerPixel;
        const schuin1 = rechts.clone().add(boven).multiplyScalar(maat);
        const schuin2 = rechts.clone().sub(boven).multiplyScalar(maat);
        for (const item of spoorVerworvenRef.current) {
          if (k + 4 > kruisPositie.count) break;
          const p = item.soort === "knoop" ? new THREE.Vector3(item.punt.x, item.punt.y, item.punt.z)
            : new THREE.Vector3((item.a.x + item.b.x) / 2, (item.a.y + item.b.y) / 2, (item.a.z + item.b.z) / 2);
          for (const schuin of [schuin1, schuin2]) {
            kruisPositie.setXYZ(k++, p.x - schuin.x, p.y - schuin.y, p.z - schuin.z);
            kruisPositie.setXYZ(k++, p.x + schuin.x, p.y + schuin.y, p.z + schuin.z);
          }
        }
      }
      kruisPositie.needsUpdate = true;
      spoorKruisGeometry.setDrawRange(0, k);
      spoorKruisBeeld.visible = k > 0;
    };
    const drawPointerPreview = () => {
      const previewStartedAt = performance.now();
      previewFrame = 0;
      const event = latestPointerEvent;
      latestPointerEvent = null;
      if (!event) return;
      const activeTool = toolRef.current;
      const pointCopy = isPointCopy();
      if (!isTekenhulpTool(activeTool) && !pointCopy) return;
      setPointer(event);
      hidePreview(preview);
      previewHint.hidden = true;
      maatLabel.hidden = true;
      const sketch = isOpeningTool(activeTool) ? openingDraftRef.current : plateDraftRef.current;
      const last = pointCopy ? drawingAnchor() ?? null : tekenStart();
      const target = drawingSnap();
      if (!pointCopy) planVerwerving(event);
      const rect = renderer.domElement.getBoundingClientRect();
      let eind: THREE.Vector3 | null = null;
      let maatMidden: { x: number; y: number } | null = null;
      if (target) {
        const start = last ? new THREE.Vector3(last.x, last.y, last.z) : null;
        // Een getypte maat (#84): de staaf loopt tot die lengte, in de richting van de muis.
        const getypteMaat = pointCopy ? null : geldigeMaat();
        const getypt = start && !isArcBoundaryTool(activeTool) ? leesMaat(getypteMaat) : null;
        const maatPunt = start && getypt !== null ? maatEindpunt(alsPunt(start), alsPunt(target.position), getypt) : null;
        eind = maatPunt ? new THREE.Vector3(maatPunt.x, maatPunt.y, maatPunt.z) : target.position;
        if (start) {
          let points: THREE.Vector3[];
          if (isArcBoundaryTool(activeTool) && sketch.arcControlNodeId !== null) {
            const control = nodeByIdRef.current!.get(sketch.arcControlNodeId);
            const arc = control ? sampleCircularArc3D(start, control, target.position) : null;
            points = arc?.map((value) => new THREE.Vector3(value.x, value.y, value.z))
              ?? [start, target.position];
          } else {
            points = [start, eind];
          }
          const attribute = previewGeometry.getAttribute("position") as THREE.BufferAttribute;
          points.forEach((point, index) => attribute.setXYZ(index, point.x, point.y, point.z));
          attribute.needsUpdate = true;
          previewGeometry.setDrawRange(0, points.length);
          (previewLine.material as THREE.LineBasicMaterial).color.setHex(isArcBoundaryTool(activeTool) ? 0x7c3aed : 0x0284c7);
          previewLine.visible = true;
          // Het maatlabel midden op de staaf in aanbouw: lengte en richting
          // in het werkvlak, of de getypte maat.
          const getypteTekst = getypteMaat !== null && !isArcBoundaryTool(activeTool)
            ? `${toonGetypteMaat(getypteMaat, taalRef.current)} mm ↵` : null;
          const maat = getypteTekst ?? maatTekst(alsPunt(start), alsPunt(eind), alsPunt(laatsteNormaal), taalRef.current);
          maatMidden = schermProjectie()(alsPunt(start.clone().add(eind).multiplyScalar(0.5)));
          if (maat && maatMidden) {
            maatLabel.textContent = maat;
            maatLabel.className = `open-fem3d-maat-label${getypteTekst ? " invoer" : ""}`;
            maatLabel.style.left = `${maatMidden.x}px`;
            maatLabel.style.top = `${maatMidden.y}px`;
            maatLabel.hidden = false;
          }
          container.dataset.openFem3dMaatLabel = maat ?? "";
        }
        previewCursor.position.copy(eind);
        previewCursor.scale.setScalar(Math.max(visualNodeRadiusRef.current * 1.25, 0.025));
        previewCursor.visible = true;
        const tekst = hintTekst(target);
        container.dataset.openFem3dSpoorTekst = tekst ?? "";
        if (tekst) {
          previewHint.textContent = tekst;
          previewHint.className = `open-fem3d-snap-hint open-fem3d-snap-${target.kind ?? (tekenToetsenRef.current.alt ? "uit" : "vrij")}`;
          previewHint.style.left = `${event.clientX - rect.left}px`;
          previewHint.style.top = `${event.clientY - rect.top}px`;
          previewHint.hidden = false;
        }
        // Bij een korte rubberband lag het maatlabel (midden op de staaf) over
        // de tekst bij de cursor: dan schuift het label het kleinste stukje
        // opzij. Eén meting per beeldje, alleen als beide in beeld staan.
        if (maatMidden && !maatLabel.hidden && !previewHint.hidden) {
          const uit = uitwijking(maatLabel.getBoundingClientRect(), previewHint.getBoundingClientRect(), 3);
          if (uit.dx !== 0 || uit.dy !== 0) {
            maatLabel.style.left = `${maatMidden.x + uit.dx}px`;
            maatLabel.style.top = `${maatMidden.y + uit.dy}px`;
          }
        }
      }
      tekenSpoor(pointCopy ? null : target, pointCopy ? null : eind);
      renderer.render(scene, camera);
      container.dataset.openFem3dPreviewMs = (performance.now() - previewStartedAt).toFixed(2);
    };
    /** Teken het voorbeeld opnieuw bij de laatste muisstand (#84). */
    const verversVoorbeeld = () => {
      if (!laatsteWijzer || (!isTekenhulpTool(toolRef.current) && !isPointCopy())) return;
      if (previewFrame) {
        cancelAnimationFrame(previewFrame);
        previewFrame = 0;
      }
      latestPointerEvent = laatsteWijzer;
      drawPointerPreview();
    };
    // Verwerven (#84): hangt de muis SPOOR_VERWERF_MS stil (binnen
    // SPOOR_STILSTAND_PX) boven een knoop of staaf, dan wordt die verworven.
    // Knopen komen uit de snapindex; de staven worden pas na de stilstand
    // doorzocht, niet bij elke muisbeweging.
    let verwerfTimer = 0;
    let verwerfPlek: { x: number; y: number } | null = null;
    const spoorActief = () => isTekenhulpTool(toolRef.current) && snapsRef.current.spoor && !tekenToetsenRef.current.alt;
    const stopVerwerving = () => {
      if (verwerfTimer) window.clearTimeout(verwerfTimer);
      verwerfTimer = 0;
      verwerfPlek = null;
    };
    const verwerfOnderMuis = () => {
      verwerfTimer = 0;
      const plek = verwerfPlek;
      if (!plek || !spoorActief() || sceneRef.current === null) return;
      const verwerfStart = performance.now();
      const index = ensureNodeSnapScreenIndex();
      const rect = renderer.domElement.getBoundingClientRect();
      const xPx = plek.x - rect.left;
      const yPx = plek.y - rect.top;
      const knoopTreffer = findOpenFem3DNodeScreenSnap(index, xPx, yPx, SPOOR_VERWERF_KNOOP_PX);
      const knoop = knoopTreffer ? nodeByIdRef.current!.get(knoopTreffer.point.id) : undefined;
      let item: VerworvenItem | null = knoop ? { soort: "knoop", id: knoop.id, punt: { x: knoop.x, y: knoop.y, z: knoop.z } } : null;
      if (!item) {
        const staafTreffer = findOpenFem3DBeamNearScreenPoint(
          modelRef.current.beams, nodeByIdRef.current!, camera, index.width, index.height, xPx, yPx, SPOOR_VERWERF_STAAF_PX,
          sceneRef.current?.sectionBox ?? null,
        );
        const staaf = staafTreffer ? beamByIdRef.current!.get(staafTreffer.beamId) : undefined;
        const a = staaf && nodeByIdRef.current!.get(staaf.startNodeId);
        const b = staaf && nodeByIdRef.current!.get(staaf.endNodeId);
        if (staaf && a && b) item = { soort: "staaf", id: staaf.id, a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z } };
      }
      container.dataset.openFem3dSpoorVerwerfMs = (performance.now() - verwerfStart).toFixed(2);
      if (!item) return;
      spoorVerworvenRef.current = verwerf(spoorVerworvenRef.current, item);
      container.dataset.openFem3dSpoorVerworven = spoorVerworvenRef.current.map((i) => `${i.soort}:${i.id}`).join(",");
      verversVoorbeeld();
    };
    const planVerwerving = (stand: WijzerStand) => {
      if (!spoorActief() || stand.buttons !== 0) {
        stopVerwerving();
        return;
      }
      if (verwerfPlek && Math.hypot(stand.clientX - verwerfPlek.x, stand.clientY - verwerfPlek.y) <= SPOOR_STILSTAND_PX) return;
      if (verwerfTimer) window.clearTimeout(verwerfTimer);
      verwerfPlek = { x: stand.clientX, y: stand.clientY };
      verwerfTimer = window.setTimeout(verwerfOnderMuis, SPOOR_VERWERF_MS);
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
      // Alt en Shift reizen met de muisgebeurtenis mee (#84).
      tekenToetsenRef.current = { alt: event.altKey, shift: event.shiftKey };
      laatsteWijzer = { clientX: event.clientX, clientY: event.clientY, buttons: event.buttons };
      latestPointerEvent = laatsteWijzer;
      if (!previewFrame) previewFrame = requestAnimationFrame(drawPointerPreview);
    };
    const onPointerLeave = () => {
      latestPointerEvent = null;
      laatsteWijzer = null;
      stopVerwerving();
      hidePreview(preview);
      previewHint.hidden = true;
      maatLabel.hidden = true;
      renderScene();
    };
    // Alt en Shift zonder muisbeweging (#84): het voorbeeld volgt meteen,
    // zoals in 2D. Alleen Alt indrukken en loslaten zet in de browser de
    // focus op het menu; boven het tekenvlak is Alt een tekenhulp.
    const onTekenModifier = (event: KeyboardEvent) => {
      if (event.key !== "Alt" && event.key !== "Shift") return;
      const neer = event.type === "keydown";
      if (neer && isInvoerVeld(event.target)) return;
      if (event.key === "Alt" && laatsteWijzer && (isTekenhulpTool(toolRef.current) || isPointCopy())) event.preventDefault();
      const alt = event.key === "Alt" ? neer : event.altKey;
      const shift = event.key === "Shift" ? neer : event.shiftKey;
      const nu = tekenToetsenRef.current;
      if (nu.alt === alt && nu.shift === shift) return;
      tekenToetsenRef.current = { alt, shift };
      verversVoorbeeld();
    };
    const onVensterBlur = () => {
      const nu = tekenToetsenRef.current;
      if (!nu.alt && !nu.shift) return;
      tekenToetsenRef.current = { alt: false, shift: false };
      verversVoorbeeld();
    };
    // Een lengte intypen (#84), zoals de maat in 2D: na het beginpunt legt een
    // getal (mm, komma of punt) de lengte vast in de richting van de muis;
    // Enter plaatst het eindpunt, Backspace wist een teken, Esc alleen de
    // getypte maat (de staaf blijft in aanbouw). Niet in invoervelden of onder
    // een dialoog, en niet bij een boog.
    const onMaatToets = (event: KeyboardEvent) => {
      const maatTeken = /^[0-9]$/.test(event.key) || event.key === "," || event.key === "."
        || event.key === "Backspace" || event.key === "Enter" || event.key === "Escape";
      if (!maatTeken || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      // `dialog` (hieronder, bij onKeyDown) kent de stand van vóór de toets:
      // een dialoog die zichzelf op Esc sluit, telt nog als open.
      if (isInvoerVeld(event.target) || dialog.open()) return;
      const tool = toolRef.current;
      const begin = tekenStart();
      if (!isTekenhulpTool(tool) || isArcBoundaryTool(tool) || begin === null) return;
      const uitkomst = maatToets(geldigeMaat(), event.key);
      if (uitkomst.actie === "geen") return;
      event.preventDefault();
      if (uitkomst.actie === "bevestig") {
        bevestigMaat();
        return;
      }
      maatInvoerRef.current = uitkomst.tekst;
      maatStart = uitkomst.tekst === null ? null : begin.id;
      container.dataset.openFem3dMaatInvoer = uitkomst.tekst ?? "";
      verversVoorbeeld();
    };
    /**
     * Enter bij een getypte maat: het eindpunt op precies die lengte vanaf het
     * beginpunt, in de richting van het tekenpunt onder de muis (met spoor en
     * ortho), en dan een klik daar zoals met de muis. Zonder richting (de muis
     * op het beginpunt) blijft de maat staan.
     */
    const bevestigMaat = () => {
      const lengteMm = leesMaat(geldigeMaat());
      const begin = tekenStart();
      if (lengteMm === null || !begin || !laatsteWijzer) return;
      setPointer(laatsteWijzer);
      const doel = drawingSnap();
      const eind = doel ? maatEindpunt({ x: begin.x, y: begin.y, z: begin.z }, alsPunt(doel.position), lengteMm) : null;
      if (!doel || !eind) return;
      const scherm = schermProjectie()(eind);
      const rect = renderer.domElement.getBoundingClientRect();
      wisMaat();
      geforceerdPunt = { position: new THREE.Vector3(eind.x, eind.y, eind.z), plane: doel.plane };
      try {
        klikOpTekenvlak({
          clientX: scherm ? rect.left + scherm.x : laatsteWijzer.clientX,
          clientY: scherm ? rect.top + scherm.y : laatsteWijzer.clientY,
          shiftKey: false, ctrlKey: false, metaKey: false,
        });
      } finally {
        geforceerdPunt = null;
      }
      verversVoorbeeld();
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
        // Zonder knoop, staaf of plaat in het kader kiest het kader de last die het raakt.
        const boxConditions = geometry.children.find((child) => child.userData.openFem3dConditions === true);
        // Met de section box (issue #86) alleen wat binnen de doos valt.
        selectRef.current(selectOpenFem3DInScreenBox(
          modelRef.current, selectionPickTargetsRef.current, camera,
          rect.width, rect.height, box, selectionRef.current, down.additive,
          visibilityRef.current.nodes, mode,
          boxConditions ? openFem3DLoadPickSegments(boxConditions) : [],
          sceneRef.current?.sectionBox ?? null,
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
      // Alt en Shift van deze klik gelden voor het tekenpunt (#84).
      tekenToetsenRef.current = { alt: event.altKey, shift: event.shiftKey };
      klikOpTekenvlak(event);
    };
    /**
     * Een klik op het tekenvlak op dit schermpunt: kiezen, plaatsen of
     * tekenen met het actieve gereedschap. Ook de bevestigde getypte maat
     * (#84) komt hier langs, met het eindpunt vast in `geforceerdPunt`.
     */
    const klikOpTekenvlak = (event: Pick<PointerEvent, "clientX" | "clientY" | "shiftKey" | "ctrlKey" | "metaKey">) => {
      setPointer(event);
      const activeTool = toolRef.current;
      // De geselecteerde geometrie blijft staan tijdens beide puntklikken.
      // Referentiepunten zijn alleen coördinaten: er wordt geen knoop aangemaakt.
      // Alleen een gewone klik is een punt: met Shift, Ctrl of Cmd vult de
      // klik de selectie aan (of haalt er iets uit), zoals bij Verplaatsen,
      // Roteren en Spiegelen (de laatste tak hieronder). Een al gekozen
      // bronpunt vervalt dan, want de selectie verandert (OpenFem3DEditor).
      if (isPointCopy() && !(event.shiftKey || event.ctrlKey || event.metaKey)) {
        const snapped = drawingSnap();
        if (snapped) {
          try {
            copyPointRef.current?.({
              x: cleanDrawingCoordinate(snapped.position.x),
              y: cleanDrawingCoordinate(snapped.position.y),
              z: cleanDrawingCoordinate(snapped.position.z),
            });
          } catch (error) {
            drawErrorRef.current?.(error instanceof Error ? error.message : String(error));
          }
        }
        hidePreview(preview);
        previewHint.hidden = true;
        maatLabel.hidden = true;
        down = null;
        renderScene();
        return;
      }
      // Raycast alleen tegen objecten die werkelijk selecteerbaar zijn. Labels,
      // rasters en resultaatlijnen hoeven bij grote modellen niet bij iedere
      // klik opnieuw doorzocht te worden.
      const pickStartedAt = performance.now();
      // Met de section box (issue #86) alleen treffers binnen de doos: een
      // staaf die de doos snijdt is alleen op zijn zichtbare stuk te raken.
      const intersections = binnenDoos(raycaster.intersectObjects(nonNodePickTargetsRef.current, false));
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
      let plateHit: { id: number; distance: number; point: THREE.Vector3 } | null = null;
      for (const candidate of solidIntersections) {
        const found = identity(candidate);
        if (!found) continue;
        if (!loadHit && LOAD_SELECTION_TYPES.has(found.type)) {
          loadHit = { type: found.type as OpenFem3DLoadSelectionType, id: found.id, distance: candidate.distance };
        } else if (!rayBeamHit && found.type === "beam") {
          rayBeamHit = { id: found.id, distance: candidate.distance, point: candidate.point.clone() };
        } else if (!plateHit && found.type === "plate") {
          plateHit = { id: found.id, distance: candidate.distance, point: candidate.point.clone() };
        }
      }
      const nodeIndex = ensureNodeSnapScreenIndex();
      const xPx = (pointer.x + 1) * nodeIndex.width / 2;
      const yPx = (1 - pointer.y) * nodeIndex.height / 2;
      const conditionGroup = geometry.children.find((child) => child.userData.openFem3dConditions === true);
      // Een lastpijl of staartlijn binnen enkele pixels, als de straal geen
      // lastteken raakte: de pijlsteel zelf is vaak dunner dan een pixel.
      const loadScreenHit = !loadHit && conditionGroup
        ? findOpenFem3DSegmentNearScreenPoint(knipOpDoos(openFem3DLoadPickSegments(conditionGroup)), camera,
            nodeIndex.width, nodeIndex.height, xPx, yPx, LOAD_PICK_RADIUS_PX)
        : null;
      if (loadScreenHit && LOAD_SELECTION_TYPES.has(loadScreenHit.item.selection.type)
        && loadScreenHit.distance <= throughLimitM) {
        loadHit = {
          type: loadScreenHit.item.selection.type as OpenFem3DLoadSelectionType,
          id: loadScreenHit.item.selection.id, distance: loadScreenHit.distance,
        };
      }
      // Een opleggingsteken hoort bij zijn knoop. Het is veel groter dan de
      // knoopbol, en een klik erop moet die knoop kiezen.
      const supportTargets: THREE.Object3D[] = [];
      conditionGroup?.traverse((object) => {
        if (object.userData.type === "node" && object.userData.pickable !== false
          && typeof (object as { raycast?: unknown }).raycast === "function") supportTargets.push(object);
      });
      const supportIntersection = supportTargets.length > 0
        ? binnenDoos(raycaster.intersectObjects(supportTargets, false)).find((candidate) => candidate.distance <= throughLimitM)
        : undefined;
      const supportFound = supportIntersection ? identity(supportIntersection) : null;
      const supportHit = supportIntersection && supportFound?.type === "node"
        ? { nodeId: supportFound.id, distance: supportIntersection.distance } : null;
      // Een knoop telt alleen als de klik op zijn getekende bol valt (met een
      // minimum van enkele pixels); zo steelt een knoop in een uitgezoomd
      // model niet de klik op de staaf ernaast. Opleggingen plaatsen en
      // tussenknopen zetten houden de ruimere zone.
      const nodeCondition = openFem3DNodeConditionOfTool(activeTool);
      const pointLoadTool = activeTool === "addPointLoad";
      const nodeTool = nodeCondition !== null || pointLoadTool || activeTool === "addSubNode";
      // Pixels per meter op diepte 1 (perspectief: 1/tan(fov/2), te delen door
      // de diepte = clip-w van de knoop) of overal (parallel: 1/h, clip-w = 1).
      const pixelsPerMeter = camera.projectionMatrix.elements[5] * nodeIndex.height / 2;
      const nodeRadiusM = visualNodeRadiusRef.current;
      const nodeHit = nodePickTargetsRef.current.some((target) => target.userData.pickable !== false)
        ? findOpenFem3DNodeAtScreenPoint(
            nodeIndex, xPx, yPx,
            (point) => nodeTool ? TOOL_NODE_PICK_RADIUS_PX
              : Math.max(NODE_PICK_MIN_RADIUS_PX, nodeRadiusM * pixelsPerMeter / Math.max(point.viewDepth, 1e-9) + 1),
            // Een kleinere knoopschaal verkleint het zoekgebied niet.
            NODE_PICK_MAX_RADIUS_PX * Math.max(1, openFem3DSymbolScaleFactor(visibilityRef.current.nodeSizePercent)),
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
            sceneRef.current?.sectionBox ?? null,
          )
        : null;
      const beamHalfSize = (beamId: number) => {
        if (!visibilityRef.current.profiles) return ANALYTICAL_BEAM_RADIUS_M;
        const pickBeam = beamByIdRef.current?.get(beamId);
        const section = pickBeam ? openFem3DBeamProfileExtent(pickBeam) : null;
        return section ? Math.hypot(section.widthM, section.heightM) / 2 : PROFILE_BEAM_RADIUS_M;
      };
      const hitPlate = plateHit ? plateByIdRef.current?.get(plateHit.id) : undefined;
      /** Tot hoever achter het geraakte plaatoppervlak iets nog bij de plaat hoort (m). */
      const plateBand = (plateId: number) => (plateByIdRef.current?.get(plateId)?.thicknessM ?? 0) / 2 + 0.25;
      // Afstand van de knoop tot de camera zoals de raycast meet (perspectief:
      // vanaf het oogpunt; parallel: langs de kijkrichting).
      const hitNodeDistance = hitNode ? openFem3DCameraAfstand(camera, hitNode) : Number.POSITIVE_INFINITY;
      // Voorrang (zie openFem3dPick.ts): een echt geraakt lastteken, dan een
      // knoop onder de klik, dan de staaf onder of vlak naast de cursor, dan
      // de plaat. Diepte beslist tussen elementen achter elkaar.
      const pick = chooseOpenFem3DPick({
        load: loadHit,
        node: nodeHit && hitNode && hitNodeDistance <= throughLimitM ? {
          id: hitNode.id,
          distance: hitNodeDistance,
          radiusM: nodeRadiusM,
        } : null,
        support: supportHit,
        rayBeam: rayBeamHit ? { ...rayBeamHit, halfSizeM: beamHalfSize(rayBeamHit.id) } : null,
        lineBeam: beamScreenHit && beamScreenHit.distance <= throughLimitM ? {
          id: beamScreenHit.beamId, distance: beamScreenHit.distance,
          halfSizeM: beamHalfSize(beamScreenHit.beamId), point: beamScreenHit.point,
        } : null,
        plate: plateHit ? { id: plateHit.id, distance: plateHit.distance, bandM: (hitPlate?.thicknessM ?? 0) / 2 + 0.25 } : null,
        // Een lastpijl is hoogstens twee markeringsmaten lang. Een last die
        // verder achter de staaf of knoop ligt, hoort bij iets anders.
        loadDepthToleranceM: 2 * openFem3DConditionMarkerSize(modelRef.current.nodes),
      });
      // Plaatsgereedschappen (oplegging, veer, puntlast; issues #76 en #77):
      // een knoop binnen de snapzone wint van de staaf of plaat eronder, dan
      // de staaf, dan de plaat; lasttekens tellen niet (chooseOpenFem3DPlacement).
      const placement = nodeCondition !== null || pointLoadTool ? (() => {
        const snapPx = snapsRef.current.knoop ? PLACEMENT_NODE_SNAP_RADIUS_PX : TOOL_NODE_PICK_RADIUS_PX;
        const nodesPickable = snapsRef.current.knoop
          || nodePickTargetsRef.current.some((target) => target.userData.pickable !== false);
        const snapHit = nodesPickable
          ? findOpenFem3DNodeAtScreenPoint(
              nodeIndex, xPx, yPx,
              // De snapzone, of de getekende bol als die groter is (regelaar Knopen, issue #82).
              (point) => Math.max(snapPx, nodeRadiusM * pixelsPerMeter / Math.max(point.viewDepth, 1e-9) + 1),
              Math.max(snapPx, NODE_PICK_MAX_RADIUS_PX * Math.max(1, openFem3DSymbolScaleFactor(visibilityRef.current.nodeSizePercent))),
            )
          : null;
        const snapNode = snapHit ? nodeByIdRef.current!.get(snapHit.point.id) : undefined;
        const snapNodeDistance = snapNode ? openFem3DCameraAfstand(camera, snapNode) : Number.POSITIVE_INFINITY;
        container.dataset.openFem3dPlacementNodeDistancePx = snapHit?.distancePx.toFixed(2) ?? "none";
        // Is de knoop zelf zichtbaar? Kijk langs zijn eigen straal, niet langs
        // de klikstraal: een staaf of plaat die naar de camera toe loopt, ligt
        // op de klikplek ruim vóór de knoop zonder hem af te dekken. Alleen
        // getekende vlakken tellen (geen diagramlijnen of doorzichtige lastvlakken);
        // de eigen staven en platen van de knoop sluit chooseOpenFem3DPlacement uit.
        const ownRay: OpenFem3DNodeRayHit[] = [];
        if (snapNode && snapNodeDistance <= throughLimitM) {
          const ndc = new THREE.Vector3(snapNode.x, snapNode.y, snapNode.z).project(camera);
          nodeRaycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
          for (const hit of binnenDoos(nodeRaycaster.intersectObjects(nonNodePickTargetsRef.current, false))) {
            if (hit.distance >= snapNodeDistance) break;
            if (!(hit.object as THREE.Mesh).isMesh || hit.object.userData.pickThrough === true) continue;
            const found = identity(hit);
            if (found?.type === "beam") {
              ownRay.push({ type: "beam", id: found.id, distance: hit.distance, halfSizeM: beamHalfSize(found.id) });
            } else if (found?.type === "plate") {
              ownRay.push({ type: "plate", id: found.id, distance: hit.distance, bandM: plateBand(found.id) });
            }
          }
        }
        const owners = snapNode
          ? openFem3DPlacementNodeOwners(modelRef.current, snapNode.id, ownRay.filter((hit) => hit.type === "plate").map((hit) => hit.id))
          : null;
        container.dataset.openFem3dPlacementNodeCover = ownRay.map((hit) => `${hit.type}:${hit.id}@${hit.distance.toFixed(3)}`).join(",") || "none";
        return chooseOpenFem3DPlacement({
          node: snapNode && owners && snapNodeDistance <= throughLimitM ? {
            id: snapNode.id, distance: snapNodeDistance, radiusM: nodeRadiusM,
            beamIds: owners.beamIds, plateIds: owners.plateIds, ownRay,
          } : null,
          support: supportHit,
          // Dezelfde staaf- en plaatkandidaten als bij selecteren hierboven.
          rayBeam: rayBeamHit ? { ...rayBeamHit, halfSizeM: beamHalfSize(rayBeamHit.id) } : null,
          lineBeam: beamScreenHit && beamScreenHit.distance <= throughLimitM ? {
            id: beamScreenHit.beamId, distance: beamScreenHit.distance,
            halfSizeM: beamHalfSize(beamScreenHit.beamId), point: beamScreenHit.point,
          } : null,
          plate: plateHit ? {
            id: plateHit.id, distance: plateHit.distance, bandM: plateBand(plateHit.id),
            point: { x: plateHit.point.x, y: plateHit.point.y, z: plateHit.point.z },
          } : null,
        });
      })() : null;
      if (placement) container.dataset.openFem3dPlacement = `${placement.type}:${placement.id}`;
      else if (nodeCondition !== null || pointLoadTool) container.dataset.openFem3dPlacement = "none";
      /** Het plaatsingsdoel van een knoop, staaf (plek in hele mm) of plaat (punt op het middenvlak, hele mm). */
      const placementTarget = (): OpenFem3DNodeTarget | null => {
        if (!placement) return null;
        if (placement.type === "node") return { nodeId: placement.id };
        if (placement.type === "plate") {
          return {
            plateId: placement.id,
            point: projectOpenFem3DPointOnPlate(modelRef.current, placement.id, placement.point, { roundToMm: true }).point,
          };
        }
        const beam = beamByIdRef.current!.get(placement.id);
        const start = beam && nodeByIdRef.current!.get(beam.startNodeId);
        const end = beam && nodeByIdRef.current!.get(beam.endNodeId);
        if (!beam || !start || !end) return null;
        const axis = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
        const lengthM = axis.length();
        if (!(lengthM > 0)) return null;
        axis.divideScalar(lengthM);
        // De plek op de systeemlijn onder de cursor: het punt van de staafas
        // dat het dichtst bij de muisstraal ligt. Een treffer op de buitenkant
        // van een zwaar profiel ligt schuin vóór de as; die zou de plek bij een
        // schuine kijkrichting centimeters verschuiven. Kijk je langs de staaf,
        // dan het geraakte punt loodrecht op de as.
        const ray = raycaster.ray;
        const fromRay = new THREE.Vector3(start.x, start.y, start.z).sub(ray.origin);
        const cosine = axis.dot(ray.direction);
        const denominator = 1 - cosine * cosine;
        const along = denominator > 1e-9
          ? (cosine * ray.direction.dot(fromRay) - axis.dot(fromRay)) / denominator
          : new THREE.Vector3(placement.point.x - start.x, placement.point.y - start.y, placement.point.z - start.z).dot(axis);
        // De plek langs de staaf op hele millimeters, zoals het paneel hem toont.
        return { beamId: beam.id, positionM: Math.min(lengthM, Math.max(0, Math.round(along * 1000) / 1000)) };
      };
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
        /** Staaf `beamId` met zijn eindknopen, of null. */
        const staafMetEinden = (beamId: number) => {
          const beam = beamByIdRef.current!.get(beamId);
          const start = beam && nodeByIdRef.current!.get(beam.startNodeId);
          const end = beam && nodeByIdRef.current!.get(beam.endNodeId);
          return beam && start && end ? { beam, start, end } : null;
        };
        /** Aansluiten op een staaf: een eindknoop, of de staaf splitsen op deze ratio. */
        const opStaaf = (staaf: NonNullable<ReturnType<typeof staafMetEinden>>, ratio: number) => {
          if (ratio <= 1e-6) return staaf.start.id;
          if (ratio >= 1 - 1e-6) return staaf.end.id;
          // Knopen automatisch samenvoegen (issue #75): een punt binnen de
          // verbindingstolerantie van een staafeind (langs de as) is die
          // eindknoop. Een splitsing daar gaf een stompje van een paar mm dat
          // de pijplijn als staaf van lengte 0 met haar lasten weggooide, en
          // de volgende klik begon bij een knoop die niet meer bestond.
          if (snapsRef.current.knopenAansluiten) {
            const eind = openFem3DBeamEndNear(staaf.start, staaf.end, ratio, snapsRef.current.verbindingsTolerantie);
            if (eind !== null) {
              container.dataset.openFem3dSamengevoegd = String(eind);
              return eind;
            }
          }
          const split = splitOpenFem3DBeam(current, staaf.beam.id, ratio);
          commitModel(split.model);
          return split.nodeId;
        };
        const tekenpunt = snapped?.tekenpunt;
        delete container.dataset.openFem3dStaafSplitsing;
        delete container.dataset.openFem3dSamengevoegd;
        // Het voetpunt 'loodrecht op staaf N' (#84) ligt op staaf N: die
        // wordt daar gesplitst, ook als de klik de staaf zelf niet raakt (het
        // voetpunt vangt binnen de spoorzone, ruimer dan de profielbreedte).
        // Op de verlenging, of een staaf buiten het werkvlak: geen splitsing.
        if (activeTool === "addBeam" && snapped && tekenpunt?.soort === "voetpunt" && tekenpunt.staafId !== undefined) {
          const staaf = staafMetEinden(tekenpunt.staafId);
          const ratio = staaf ? ratioOpStaaf(alsPunt(snapped.position), alsPunt(staaf.start), alsPunt(staaf.end)) : null;
          if (staaf && ratio !== null) {
            container.dataset.openFem3dStaafSplitsing = `${staaf.beam.id}:voetpunt`;
            return opStaaf(staaf, ratio);
          }
        }
        // Een punt van het objectspoor, ortho of een getypte maat (#84) ligt
        // vast. Raakt de klik een staaf, dan wordt die gesplitst op dat punt
        // als het op de staaf ligt, anders op het snijpunt van de spoor- of
        // ortholijn met de staaf (staafSplitsing). Zonder zo'n snijpunt op het
        // raakpunt, zoals zonder tekenhulp; alleen een getypte maat blijft
        // exact (dan een losse knoop op die maat).
        const vastPunt = snapped && (snapped.kind === "spoor" || snapped.kind === "ortho" || snapped.kind === "invoer")
          ? snapped.position : null;
        if (activeTool === "addBeam" && type === "beam" && typeof id === "number" && pickPoint) {
          const staaf = staafMetEinden(id);
          if (staaf) {
            const a = new THREE.Vector3(staaf.start.x, staaf.start.y, staaf.start.z);
            const delta = new THREE.Vector3(staaf.end.x - staaf.start.x, staaf.end.y - staaf.start.y, staaf.end.z - staaf.start.z);
            const raakRatio = pickPoint.clone().sub(a).dot(delta) / delta.lengthSq();
            if (!vastPunt) return opStaaf(staaf, raakRatio);
            const vlak: Werkvlak = snapped?.vlak
              ?? { punt: alsPunt(vastPunt), normaal: alsPunt(snapped?.plane?.normal ?? laatsteNormaal) };
            const keuze = staafSplitsing({
              punt: alsPunt(vastPunt), lijnen: tekenpunt?.lijnen ?? [], vlak,
              a: alsPunt(staaf.start), b: alsPunt(staaf.end),
              cursorPx: { x: xPx, y: yPx }, naarScherm: schermProjectie(),
            });
            const viaRaakpunt = !keuze && snapped?.kind !== "invoer";
            container.dataset.openFem3dStaafSplitsing = `${staaf.beam.id}:${keuze?.via ?? (viaRaakpunt ? "raakpunt" : "geen")}`;
            if (keuze) return opStaaf(staaf, keuze.ratio);
            if (viaRaakpunt) return opStaaf(staaf, raakRatio);
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
        // Knopen automatisch samenvoegen (issue #75): met de schakelaar aan
        // wordt een punt binnen de verbindingstolerantie van een bestaande
        // knoop die knoop, in plaats van een nieuwe knoop ernaast. Hier, en
        // niet pas in de pijplijn van de app: de staaf- en contourtekening gaan
        // van deze knoop verder, en een knoop die de pijplijn daarna
        // samenvoegde, liet de volgende klik beginnen bij een knoop die er niet
        // meer is. In een plaat- of openingcontour alleen een knoop in het
        // tekenvlak (de contour blijft vlak), en nooit het stuurpunt van een
        // boog in aanbouw (zoals bij de knoopsnap).
        if (snapsRef.current.knopenAansluiten) {
          const schets = isOpeningTool(activeTool) ? openingDraftRef.current : plateDraftRef.current;
          const stuurpunt = isArcBoundaryTool(activeTool) ? schets.arcControlNodeId : null;
          const inVlak = isPlateSketchTool(activeTool) || isOpeningTool(activeTool);
          const binnen = openFem3DNodeNearPoint(current.nodes, position, snapsRef.current.verbindingsTolerantie, (node) =>
            node.id !== stuurpunt && (!inVlak || Math.abs(laatsteNormaal.x * (node.x - position.x)
              + laatsteNormaal.y * (node.y - position.y) + laatsteNormaal.z * (node.z - position.z)) <= 1e-5));
          if (binnen) {
            container.dataset.openFem3dSamengevoegd = String(binnen.id);
            return binnen.id;
          }
        }
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
                } else if (activeTool === "addEnvelopePanel") {
                  const normal = openFem3DLoadPanelGeometry(current, { id: 0, nodeIds, distribution: "twoWay" }).normal;
                  const next = addOpenFem3DEnvelopePanel(current, {
                    nodeIds, type: Math.abs(normal[2]) >= 0.5 ? "roof" : "facade", distribution: "twoWay",
                  });
                  const addedPanel = next.envelopePanels?.[next.envelopePanels.length - 1];
                  commitModel(next);
                  committed = true;
                  drawErrorRef.current?.(null);
                  if (addedPanel) selectRef.current({ type: "envelopePanel", id: addedPanel.id });
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
            // Binnen de verbindingstolerantie van een staafeind de eindknoop
            // (issue #75, zoals `opStaaf` bij het tekenen): een tussenknoop
            // daar zou de pijplijn met het stompje en zijn lasten weer weggooien.
            const eind = snapsRef.current.knopenAansluiten && ratio > 1e-6 && ratio < 1 - 1e-6
              ? openFem3DBeamEndNear(start, end, ratio, snapsRef.current.verbindingsTolerantie) : null;
            if (ratio <= 1e-6) selectRef.current({ type: "node", id: start.id });
            else if (ratio >= 1 - 1e-6) selectRef.current({ type: "node", id: end.id });
            else if (eind !== null) selectRef.current({ type: "node", id: eind });
            else {
              const split = splitOpenFem3DBeam(current, id, ratio);
              changeRef.current(split.model);
              selectRef.current({ type: "node", id: split.nodeId });
            }
          }
        }
      } else if (activeTool === "beamEndHinge") {
        // Scharnier aan staafeind (#93): een klik op of vlak naast een staaf
        // (ook op een scharnierbolletje) kiest het dichtstbijzijnde eind; My en
        // Mz daar los, of weer vast als ze al los stonden. Torsie blijft zoals
        // hij is. Eén modelwijziging, dus één stap ongedaan maken.
        if (type === "beam" && typeof id === "number" && pickPoint) {
          const beam = beamByIdRef.current!.get(id);
          const start = beam && nodeByIdRef.current!.get(beam.startNodeId);
          const end = beam && nodeByIdRef.current!.get(beam.endNodeId);
          if (beam && start && end) {
            const a = new THREE.Vector3(start.x, start.y, start.z);
            const delta = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
            const ratio = pickPoint.clone().sub(a).dot(delta) / delta.lengthSq();
            const beamEnd = ratio < 0.5 ? "start" : "end";
            const toggled = setOpenFem3DBeamEndHinge(current, id, beamEnd);
            if (toggled.model !== current) commitModel(toggled.model);
            selectRef.current({ type: "beam", id });
            container.dataset.openFem3dBeamEndHinge = `${id}:${beamEnd}:${toggled.hinged ? "los" : "vast"}`;
          }
        }
      } else if (activeTool === "addMemberLoad") {
        if (type === "beam" && typeof id === "number") {
          selectRef.current({ type: "beam", id });
        }
      } else if (nodeCondition && placeNodeConditionRef.current) {
        // Oplegging of veer (issue #76): op de knoop binnen de snapzone (ook
        // als de klik een staaf of plaat raakt), op een staaf (die daar
        // gesplitst wordt), op een plaat (nieuwe knoop in het middenvlak) of
        // in leeg canvas op het werkvlak, met knoop-, stramien- en rastersnap
        // zoals bij het tekenen. Knoop en voorwaarde zijn één modelwijziging;
        // een geweigerde plek (bijv. in een opening) komt als melding in beeld.
        try {
          let target = placementTarget();
          if (!target && !placement) {
            const snapped = drawingSnap();
            if (snapped?.nodeId !== undefined) target = { nodeId: snapped.nodeId };
            else if (snapped) {
              target = { position: {
                x: cleanDrawingCoordinate(snapped.position.x),
                y: cleanDrawingCoordinate(snapped.position.y),
                z: cleanDrawingCoordinate(snapped.position.z),
              } };
            }
          }
          if (target) {
            placeNodeConditionRef.current(target);
            drawErrorRef.current?.(null);
          }
        } catch (error) {
          drawErrorRef.current?.(error instanceof Error ? error.message : String(error));
        }
        container.dataset.openFem3dNodeCondition = placement?.type ?? "work-plane";
      } else if (pointLoadTool && placePointLoadRef.current) {
        // Puntlast (issue #77): op een knoop een knooplast, op een staaf een
        // staafpuntlast op de aangeklikte plek. Op een plaat of in leeg canvas
        // gebeurt niets, met een korte melding.
        const target = placement?.type === "node" || placement?.type === "beam" ? placementTarget() : null;
        if (target && ("nodeId" in target || "beamId" in target)) {
          try {
            placePointLoadRef.current(target);
            drawErrorRef.current?.(null);
          } catch (error) {
            drawErrorRef.current?.(error instanceof Error ? error.message : String(error));
          }
        } else {
          drawErrorRef.current?.(pointLoadMissedTextRef.current);
        }
        container.dataset.openFem3dPointLoad = placement?.type ?? "none";
      } else {
        // De keuze levert altijd een selecteerbaar type (zie openFem3dPick.ts).
        const selectable = type !== undefined && typeof id === "number"
          ? { type, id } as OpenFem3DSingleSelection
          : null;
        selectRef.current(selectable
          ? toggleOpenFem3DSelection(selectionRef.current, selectable, event.shiftKey || event.ctrlKey || event.metaKey)
          : null);
      }
      // Een klik met een tekengereedschap zet een punt: een getypte maat is
      // daarmee voorbij, zoals in 2D (#84). (Enter wist hem al vóór de klik.)
      if (isTekenhulpTool(activeTool)) wisMaat();
      drawDraftContour(
        isOpeningTool(activeTool)
          ? openingDraftRef.current
          : isPlateSketchTool(activeTool) ? plateDraftRef.current : null,
        isOpeningTool(activeTool),
      );
      hidePreview(preview);
      previewHint.hidden = true;
      maatLabel.hidden = true;
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
    // De tekenhulpen eerst: een getypte maat vangt Esc af voordat het
    // gereedschap stopt (onKeyDown kijkt naar defaultPrevented).
    window.addEventListener("keydown", onTekenModifier);
    window.addEventListener("keyup", onTekenModifier);
    window.addEventListener("blur", onVensterBlur);
    window.addEventListener("keydown", onMaatToets);
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
      renderer.domElement.removeEventListener("pointerdown", onPanStart, true);
      renderer.domElement.removeEventListener("pointerdown", onGreepDown, true);
      renderer.domElement.removeEventListener("pointermove", onGreepMove, true);
      renderer.domElement.removeEventListener("pointerup", onGreepUp, true);
      renderer.domElement.removeEventListener("pointercancel", onGreepUp, true);
      window.removeEventListener("keydown", onGreepToets);
      greepSleep = null;
      sectionBoxToepassenRef.current = null;
      scene.onBeforeRender = () => {};
      sectionBoxBeeld.dispose();
      selectionBox.remove();
      window.removeEventListener("keydown", onTekenModifier);
      window.removeEventListener("keyup", onTekenModifier);
      window.removeEventListener("blur", onVensterBlur);
      window.removeEventListener("keydown", onMaatToets);
      stopVerwerving();
      window.removeEventListener("keydown", onKeyDown);
      dialog.stop();
      controls.removeEventListener("start", startCameraInteraction);
      controls.removeEventListener("change", followOrbitPivot);
      controls.removeEventListener("change", houdOrthoCameraVrij);
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
      maatLabel.remove();
      viewCube.verwijder();
      projectieRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // Perspectief of parallel (zichtbaarheid `perspective`): de camera wisselt
  // en het vinkje van het menu-item Perspectief volgt. Vóór de effecten van
  // lintaanzicht en camera hieronder, zodat die al in de juiste stand richten.
  useEffect(() => {
    projectieRef.current?.(visibility.perspective);
    const viewCube = sceneRef.current?.viewCube;
    if (viewCube && viewCubeMenuRef.current) viewCube.zetMenu(viewCubeMenuRef.current(viewCubeTekstenRef.current));
  }, [visibility.perspective]);

  // De section box (issue #86) uit de zichtbaarheid: vóór de scène-opbouw
  // hieronder, zodat die al met de doos tekent. Alleen de doos anders: de
  // opbouw neemt het snelle pad "section-box" (alleen tekenen).
  useEffect(() => {
    sectionBoxToepassenRef.current?.(visibility.sectionBox ?? DEFAULT_OPEN_FEM_3D_SECTION_BOX);
  }, [visibility.sectionBox]);

  // Het menu ▾ volgt de doos (het vinkje) en de selectie (passend op selectie kan alleen met een selectie).
  const heeftSelectie = selection !== null;
  useEffect(() => {
    const viewCube = sceneRef.current?.viewCube;
    if (viewCube && viewCubeMenuRef.current) viewCube.zetMenu(viewCubeMenuRef.current(viewCubeTekstenRef.current));
  }, [visibility.sectionBox?.enabled, visibility.explode.amountM, heeftSelectie]);

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
    nextGrid.userData.openFem3dNietKnippen = true;
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
    // Parallel: het nieuwe raster kan buiten de bol om de vorige scène reiken.
    if (isOpenFem3DOrtho(state.camera)) plaatsOrthoCamera(state);
    // Een modelwijziging rendert direct hierna in de scène-effect opnieuw.
    // Teken alleen apart wanneer uitsluitend de rasterafstand wijzigt.
    if (lastBuiltModelRef.current === model) state.renderer.render(state.scene, state.camera);
  }, [model.nodes, gridSpacingM]);

  // Parallel: andere knopen, een ander raster of andere stramienen kunnen
  // buiten de bol om de vorige scène reiken (openFem3DOrthoAfstand). Zet de
  // camera dan weer ver genoeg terug, ook zonder camerabeweging; het beeld
  // verandert er niet door (alleen de diepte). De modelopbouw hieronder tekent.
  useEffect(() => {
    const state = sceneRef.current;
    if (state && isOpenFem3DOrtho(state.camera)) plaatsOrthoCamera(state);
  }, [model.nodes, gridSpacingM, structuralGrid]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const rebuildStartedAt = performance.now();
    // Alleen de twee snelle paden van de regelaars zetten dit weer (issue #82).
    // Elke andere run (ook een volledige opbouw met dezelfde zichtbaarheid,
    // bijvoorbeeld door nieuwe benuttingen) maakt de plaatvlakken mogelijk
    // opnieuw aan; de plaatlaag moet dan haar contourdekking opnieuw zetten.
    symbolScalePathRef.current = null;
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
        // Net buiten de getekende plaat: in Vlak en Mesh dus bij het middenvlak (issue #78).
        const surface = openFem3DSurfaceLoadSurface(model, plate, load, nodeByIdRef.current ?? undefined,
          visibility.plateDisplay);
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
    const addEnvelopePanelLayer = (group: THREE.Group) => {
      if (!visibility.envelopePanels) return;
      for (const panel of model.envelopePanels ?? []) {
        const surface = openFem3DLoadPanelSurface(model, {
          ...panel, q: 1, direction: "normal",
        });
        if (!surface) continue;
        const color = panel.type === "facade" ? 0x0891b2 : 0x8b5cf6;
        for (const object of openFem3DLoadSurfaceObjects(surface, color, { type: "envelopePanel", id: panel.id })) {
          group.add(object);
        }
        try {
          const { outwardNormal } = openFem3DEnvelopePanelGeometry(model, panel);
          const arrow = new THREE.ArrowHelper(
            new THREE.Vector3(...outwardNormal), new THREE.Vector3(...surface.anchor),
            Math.max(0.3, Math.min(1, Math.sqrt(surface.areaM2) * 0.12)), color,
          );
          arrow.traverse((object) => { object.userData.pickable = false; });
          group.add(arrow);
        } catch { /* Ongeldige meetkunde blijft via de eigenschappen zichtbaar. */ }
      }
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
      addEnvelopePanelLayer(next);
      geometry.add(next);
      let addedLabels = 0;
      next.traverse((object) => {
        if (object instanceof CSS2DObject) addedLabels += 1;
        if ((object.userData.type === "loadPanel" || object.userData.type === "envelopePanel") && object.userData.pickable !== false
          && typeof (object as { raycast?: unknown }).raycast === "function") {
          selectionPickTargetsRef.current.push(object);
          nonNodePickTargetsRef.current.push(object);
        }
      });
      applySelectionHighlight(next, selectionRef.current);
      return addedLabels - removedLabels;
    };
    /**
     * Vervang alleen de laag met oppervlaktelasten (vulling, pijlen, labels)
     * met haar klikdoelen; geeft het verschil in zichtbare labels terug.
     */
    const replaceSurfaceLoadLayer = (plateGeometry: PlateGeometryFor) => {
      const old = geometry.children.find((child) => child.userData.openFem3dSurfaceLoads === true);
      const oldTargets = new Set<THREE.Object3D>();
      let removedLabels = 0;
      if (old instanceof THREE.Group) {
        old.traverse((object) => {
          oldTargets.add(object);
          if (old.visible && object instanceof CSS2DObject) removedLabels += 1;
        });
        geometry.remove(old);
        disposeGroup(old);
      }
      selectionPickTargetsRef.current = selectionPickTargetsRef.current.filter((target) => !oldTargets.has(target));
      nonNodePickTargetsRef.current = nonNodePickTargetsRef.current.filter((target) => !oldTargets.has(target));
      const next = new THREE.Group();
      next.userData.openFem3dSurfaceLoads = true;
      addSurfaceLoadMarkers(next, plateGeometry);
      geometry.add(next);
      let addedLabels = 0;
      next.traverse((object) => {
        if (object instanceof CSS2DObject) addedLabels += 1;
        if (object.userData.type === "surfaceLoad" && object.userData.pickable !== false
          && typeof (object as { raycast?: unknown }).raycast === "function") {
          selectionPickTargetsRef.current.push(object);
          nonNodePickTargetsRef.current.push(object);
        }
      });
      applySelectionHighlight(next, selectionRef.current);
      return addedLabels - removedLabels;
    };
    /**
     * Breng de scharnierbolletjes bij na een snelle opbouw (verplaatste
     * knopen, toegevoegde of weggehaalde staven, staven of profielen aan of
     * uit). Alleen als er iets anders getekend moet worden, komt er een nieuwe
     * laag, met zijn klikdoelen.
     */
    const syncBeamHingeLayer = () => {
      const placements = beamHingePlacementsFor(model, visibility, visualNodeRadiusRef.current);
      const old = geometry.children.find((child) => child.userData.openFem3dBeamHinges === true);
      if (containerRef.current) containerRef.current.dataset.openFem3dBeamHinges = String(placements.length);
      if (old && old.userData.openFem3dBeamHingeKey === beamHingeLayerKey(placements)) return;
      if (old instanceof THREE.Group) {
        const oldTargets = new Set<THREE.Object3D>();
        old.traverse((object) => { oldTargets.add(object); });
        geometry.remove(old);
        disposeGroup(old);
        selectionPickTargetsRef.current = selectionPickTargetsRef.current.filter((target) => !oldTargets.has(target));
        nonNodePickTargetsRef.current = nonNodePickTargetsRef.current.filter((target) => !oldTargets.has(target));
      }
      const next = buildBeamHingeLayer(placements);
      geometry.add(next);
      next.traverse((object) => {
        if (object.userData.type === "beam" && object.userData.pickable !== false
          && typeof (object as { raycast?: unknown }).raycast === "function") {
          selectionPickTargetsRef.current.push(object);
          nonNodePickTargetsRef.current.push(object);
        }
      });
      applySelectionHighlight(next, selectionRef.current);
    };
    // De conditielaag kan alleen los worden ververst wanneer de verzameling
    // oppervlaktebelastingen gelijk blijft; wijzigingen krijgen hun eigen pad.
    const noSurfaceLoadsInEitherModel =
      (conditionModel?.surfaceLoads?.length ?? model.surfaceLoads?.length ?? 0) === 0
      && (lastBuiltConditionModelRef.current?.surfaceLoads?.length
        ?? previousModel?.surfaceLoads?.length ?? 0) === 0;
    const conditionLayerHasNoSurfaceLoads = !visibility.loads || noSurfaceLoadsInEitherModel;
    // De view cube en de projectie zijn geen scène-inhoud: alleen een van
    // beide omzetten bouwt niets op (hun eigen effecten tonen of verbergen de
    // kubus, of wisselen de camera, en delen de labels opnieuw in).
    const viewCubeOnly = previousModel === model
      && visibilityChangedOnly("viewCube", "perspective")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    if (viewCubeOnly) {
      const projectie = visibility.perspective !== previousPresentation?.visibility.perspective;
      rememberBuiltPresentation();
      if (containerRef.current) writeBuildMode(containerRef.current, projectie ? "projection" : "view-cube");
      return;
    }
    // Alleen de section box (issue #86): het effect hierboven heeft de doos al
    // toegepast (de clipping planes zijn uniforms). Niets opbouwen, alleen
    // tekenen en de labels (binnen of buiten de doos) opnieuw indelen.
    const sectionBoxOnly = previousModel === model
      && visibilityChangedOnly("sectionBox")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    if (sectionBoxOnly) {
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "section-box");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
      }
      return;
    }
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
    // Peilmaten aan/uit (issue #92): de bestaande groep tonen of verbergen,
    // zolang hij bij deze modelrand en levels hoort. Geen groep: de volledige
    // opbouw maakt hem.
    const levelMarksVisibilityOnly = previousModel === model
      && visibilityChangedOnly("levelMarks")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const existingLevelMarks = levelMarksVisibilityOnly && structuralGrid
      ? geometry.children.find((child) => child.userData.openFem3dLevelMarks === true
        && child.userData.openFem3dLayoutKey === levelMarksLayoutKey(levelMarkRand(model, structuralGrid, visibility), structuralGrid))
      : undefined;
    if (existingLevelMarks instanceof THREE.Group) {
      existingLevelMarks.visible = visibility.levelMarks;
      state.levelMarks = existingLevelMarks;
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "level-marks-visibility");
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
            visibility.nodeNumbers ? String(openFem3DExplodeSourceNodeId(node.id)) : "",
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
    // De regelaar Knopen (issue #82): alleen de bol van de knoopbatch en zijn
    // klikzone krijgen een nieuwe straal (de instanties blijven staan), en de
    // scharnierbolletjes volgen. Geen volledige opbouw, ook niet tijdens het
    // schuiven.
    const nodeScaleOnly = previousModel === model
      && visibilityChangedOnly("nodeSizePercent")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const scaledNodeMeshes = nodeScaleOnly
      ? geometry.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh
        && (child.userData.openFem3dNodeVisual === true || child.userData.openFem3dNodeHit === true))
      : [];
    if (nodeScaleOnly && scaledNodeMeshes.length === 2) {
      const nodeRadius = scaledNodeRadius(model, visibility);
      for (const mesh of scaledNodeMeshes) {
        const hit = mesh.userData.openFem3dNodeHit === true;
        // Dezelfde bollen als de volledige opbouw (zie nodeGeometry en nodeHitGeometry).
        const next = hit ? new THREE.SphereGeometry(nodeRadius * 2.6, 12, 8) : new THREE.SphereGeometry(nodeRadius, 24, 16);
        mesh.geometry.dispose();
        mesh.geometry = next;
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
      visualNodeRadiusRef.current = nodeRadius;
      syncBeamHingeLayer();
      symbolScalePathRef.current = { visibility, kind: "node" };
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "node-scale");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
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
      syncBeamHingeLayer();
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
        const key = `${openFem3DBeamProfileKey(beam) ?? ""}\u0000${length.toFixed(9)}`;
        if (visibility.profiles && beam.profileName && !profileGeometries.has(key)) {
          profileGeometries.set(key, createOpenFem3DBeamProfileGeometry(beam, length));
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
          geometry.add(makeLabel(openFem3DProfielTekst(beam, t), "open-fem3d-profile-label",
            a.clone().add(b).multiplyScalar(0.5).addScaledVector(axes.ez, -0.3)));
        }
        geometry.add(mesh);
        selectionPickTargetsRef.current.push(mesh);
        nonNodePickTargetsRef.current.push(mesh);
      }
      syncBeamHingeLayer();
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
    // Een andere plaatweergave (issue #78: volume, vlak of mesh) raakt alleen de
    // plaatlaag: de plaatobjecten (ook GPU-batches en hun gebundelde randen)
    // worden in de nieuwe stand opnieuw gemaakt, de rest van de scène blijft
    // staan. Het rekennet en de contour volgen in de plaatlaag hieronder
    // (eigen effect). De pijlen van oppervlaktelasten wijzen in elke stand naar
    // het middenvlak, maar hun gevulde vlak ligt net buiten de getekende plaat:
    // buiten de dikte bij Volume, bij het middenvlak bij Vlak en Mesh. Gaat de
    // wissel van of naar Volume, dan komt ook de laag met oppervlaktelasten
    // opnieuw; tussen Vlak en Mesh blijft die staan.
    const plateDisplayOnly = previousModel === model
      && visibilityChangedOnly("plateDisplay")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    if (plateDisplayOnly) {
      const plateLayerStartedAt = performance.now();
      const oldPlateObjects = geometry.children.filter(isPlateLayerObject);
      // Waren de platen al getekend (ook verborgen, na Platen uit), dan komen ze
      // in de nieuwe stand terug; anders is er niets te vervangen.
      const hadPlateLayer = oldPlateObjects.length > 0;
      const oldTargets = new Set<THREE.Object3D>();
      for (const object of oldPlateObjects) {
        object.traverse((child) => { oldTargets.add(child); });
        geometry.remove(object);
        disposeObject3D(object);
      }
      selectionPickTargetsRef.current = selectionPickTargetsRef.current.filter((target) => !oldTargets.has(target));
      nonNodePickTargetsRef.current = nonNodePickTargetsRef.current.filter((target) => !oldTargets.has(target));
      let plateGeometryMs = 0;
      // Eén geometrie per plaat in deze wissel, voor de plaatlaag en de lastvlakken samen.
      const plateGeometryById = new Map<number, OpenFem3DPlateGeometry | null>();
      const plateGeometryFor: PlateGeometryFor = (plate) => {
        if (!plateGeometryById.has(plate.id)) {
          const startedAt = performance.now();
          plateGeometryById.set(plate.id,
            createOpenFem3DPlateGeometry(model, plate, nodeByIdRef.current ?? undefined, visibility.plateDisplay));
          plateGeometryMs += performance.now() - startedAt;
        }
        return plateGeometryById.get(plate.id) ?? null;
      };
      const owned = new Set<THREE.BufferGeometry>();
      const plateObjects = hadPlateLayer || visibility.plates
        ? buildPlateLayerObjects(model.plates ?? [], plateGeometryFor, visibility.plateDisplay, owned)
        : [];
      const previousPlateDisplay = previousPresentation!.visibility.plateDisplay;
      const surfaceLoadsMove = visibility.loads && (model.surfaceLoads?.length ?? 0) > 0
        && Boolean(OPEN_FEM_3D_PLATE_DISPLAY_STYLES[previousPlateDisplay]?.flat)
          !== Boolean(OPEN_FEM_3D_PLATE_DISPLAY_STYLES[visibility.plateDisplay]?.flat);
      const surfaceLabelDelta = surfaceLoadsMove ? replaceSurfaceLoadLayer(plateGeometryFor) : 0;
      // In een batch hangt per vorm één geometrie aan de scène; de rest vrijgeven.
      for (const built of plateGeometryById.values()) if (built && !owned.has(built.geometry)) built.geometry.dispose();
      for (const object of plateObjects) {
        object.visible = visibility.plates;
        geometry.add(object);
        if (visibility.plates && object.userData.type === "plate" && object.userData.pickable !== false) {
          selectionPickTargetsRef.current.push(object);
          nonNodePickTargetsRef.current.push(object);
        }
      }
      applySelectionHighlight(geometry, selectionRef.current);
      const plateLayerMs = performance.now() - plateLayerStartedAt;
      const renderStartedAt = performance.now();
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      selectionRenderedWithModelRef.current = selectionRef.current;
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "plate-display");
        containerRef.current.dataset.openFem3dPlateDisplay = visibility.plateDisplay;
        if (surfaceLabelDelta !== 0) {
          containerRef.current.dataset.openFem3dLabels = String(Math.max(0,
            Number(containerRef.current.dataset.openFem3dLabels ?? 0) + surfaceLabelDelta));
        }
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dPlateGeometryMs = plateGeometryMs.toFixed(2);
        containerRef.current.dataset.openFem3dPlateLayerMs = plateLayerMs.toFixed(2);
        containerRef.current.dataset.openFem3dFullRenderMs = (performance.now() - renderStartedAt).toFixed(2);
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
      && model.envelopePanels === previousModel.envelopePanels
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
    // De regelaar Opleggingen (issue #82). Elk deel van een opleggingsteken
    // ligt op knoop + maat × vaste vector en is maat × vaste vorm groot: het
    // teken bij een andere maat is dus precies dit teken, geschaald om zijn
    // knoop. Dat doet het snelle pad, per mesh en per GPU-instantie; de
    // lasten in dezelfde laag blijven onaangeroerd. Lukt dat niet, dan bouwt
    // de conditielaag hieronder opnieuw op (ook zonder volledige opbouw).
    const supportScaleOnly = previousModel === model
      && visibilityChangedOnly("supportSizePercent")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const scaledConditions = supportScaleOnly
      ? geometry.children.find((child) => child.userData.openFem3dConditions === true)
      : undefined;
    // Banden van staven op bedding (#106) liggen langs de staaf, niet om een
    // knoop: dan bouwt de conditielaag hieronder opnieuw op.
    if (supportScaleOnly && scaledConditions instanceof THREE.Group && !scaledConditions.userData.openFem3dBeddingBands) {
      const ratio = openFem3DSymbolScaleFactor(visibility.supportSizePercent)
        / openFem3DSymbolScaleFactor(previousPresentation.visibility.supportSizePercent);
      const pivots = indexOpenFem3DNodes(conditionModel ?? model);
      const pivot = new THREE.Vector3();
      const matrix = new THREE.Matrix4();
      const around = new THREE.Matrix4();
      const scaleAbout = (nodeId: number) => {
        const node = pivots.get(nodeId);
        if (!node) return null;
        pivot.set(node.x, node.y, node.z);
        // T(p) · S(r) · T(−p): schalen om de knoop.
        return around.makeTranslation(pivot.x * (1 - ratio), pivot.y * (1 - ratio), pivot.z * (1 - ratio))
          .multiply(matrix.makeScale(ratio, ratio, ratio));
      };
      let scaledParts = 0;
      for (const part of scaledConditions.children) {
        if (part.userData.type !== "node") continue;
        if (part instanceof THREE.InstancedMesh) {
          const ids = part.userData.instanceIds as number[] | undefined;
          const instance = new THREE.Matrix4();
          for (let index = 0; index < part.count; index += 1) {
            const transform = ids ? scaleAbout(ids[index]!) : null;
            if (!transform) continue;
            part.getMatrixAt(index, instance);
            part.setMatrixAt(index, instance.premultiply(transform));
            scaledParts += 1;
          }
          part.instanceMatrix.needsUpdate = true;
          part.computeBoundingBox();
          part.computeBoundingSphere();
        } else if (scaleAbout(part.userData.id as number)) {
          part.position.sub(pivot).multiplyScalar(ratio).add(pivot);
          part.scale.multiplyScalar(ratio);
          part.updateMatrix();
          scaledParts += 1;
        }
      }
      symbolScalePathRef.current = { visibility, kind: "support" };
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "support-scale");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.openFem3dScaledSupportParts = String(scaledParts);
      }
      return;
    }
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
      && model.envelopePanels === previousModel.envelopePanels
      && (model.loads !== previousModel.loads || model.memberLoads !== previousModel.memberLoads
        || model.memberPointLoads !== previousModel.memberPointLoads
        || model.thermalLoads !== previousModel.thermalLoads);
    const conditionLayerOnly = (previousModel === model || changedConditionLoadsOnly)
      && previousPresentation !== null
      && (sameOpenFem3DVisibility(visibility, previousPresentation.visibility)
        || supportVisibilityOnly || loadVisibilityOnly || supportScaleOnly)
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && (supportVisibilityOnly || loadVisibilityOnly || supportScaleOnly
        || conditionModel !== lastBuiltConditionModelRef.current
        || activeLoadCaseId !== previousPresentation.activeLoadCaseId);
    if (conditionLayerOnly) {
      const refreshSurfaceLoads = loadVisibilityOnly
        || activeLoadCaseId !== previousPresentation.activeLoadCaseId;
      let surfaceLabelDelta = 0;
      if (refreshSurfaceLoads) {
        const temporaryGeometries: THREE.BufferGeometry[] = [];
        surfaceLabelDelta = replaceSurfaceLoadLayer((plate) => {
          const built = createOpenFem3DPlateGeometry(model, plate, nodeByIdRef.current ?? undefined, visibility.plateDisplay);
          if (built) temporaryGeometries.push(built.geometry);
          return built;
        });
        temporaryGeometries.forEach((plateGeometry) => plateGeometry.dispose());
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
          + surfaceLabelDelta + loadPanelLabelDelta);
        writeBuildMode(containerRef.current, supportScaleOnly ? "support-scale-conditions" : "conditions");
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
      && sameOpenFem3DEntities(model.envelopePanels, previousModel.envelopePanels)
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
        const built = createOpenFem3DPlateGeometry(model, plate, nodeByIdRef.current ?? undefined, visibility.plateDisplay);
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
      && model.loadPanels === previousModel.loadPanels
      && model.envelopePanels === previousModel.envelopePanels;
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
        && sameOpenFem3DEntities(model.envelopePanels, previousModel.envelopePanels)
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
      const built = createOpenFem3DPlateGeometry(model, changedPlate, nodeByIdRef.current ?? undefined, visibility.plateDisplay);
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
        // In de gekozen plaatweergave (issue #78), zoals de volledige opbouw.
        const mesh = createPlateObject(built, changedPlate.id, visibility.plateDisplay);
        geometry.add(mesh);
        selectionPickTargetsRef.current.push(mesh);
        nonNodePickTargetsRef.current.push(mesh);
        syncBeamHingeLayer();
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
        || (!(markerModel.supports ?? []).some((support) => movedNodeIds.has(support.nodeId))
          // De band van een staaf op bedding schuift mee met haar knopen (#106).
          && !affectedBeams.some((beam) => beam.bedding !== undefined)))
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
      || visibility.shearZ || visibility.torsion || visibility.momentY || visibility.momentZ || visibility.groundPressure
    );
    const utilizationGeometryStable = !visibility.utilization
      || !utilizations.some((value) => affectedBeamIds.has(value.beamId));
    const previousBounds = lastBuiltNodeBoundsRef.current;
    const movedInsideBounds = previousBounds !== null
      && movedNodes.every((node) => previousBounds.containsPoint(new THREE.Vector3(node.x, node.y, node.z)));
    const movedNodeRadiusStable = movedInsideBounds
      || Math.abs(scaledNodeRadius(model, visibility) - visualNodeRadiusRef.current) < 1e-12;
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
          const built = createOpenFem3DPlateGeometry(model, plate, nodeByIdRef.current ?? undefined, visibility.plateDisplay);
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
            ? `profile\u0000${openFem3DBeamProfileKey(beam)!}`
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
          // De peilmaten hangen aan de rand van het model: mee verplaatsen.
          // Een verborgen groep gaat weg; weer aanzetten bouwt hem dan opnieuw.
          replaceOpenFem3DLevelMarks(state, model, structuralGrid, visibility);
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
              visibility.nodeNumbers ? String(openFem3DExplodeSourceNodeId(node.id)) : "",
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
        syncBeamHingeLayer();
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
            ? `profile\u0000${openFem3DBeamProfileKey(beam)!}`
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
              visibility.nodeNumbers ? String(openFem3DExplodeSourceNodeId(node.id)) : "",
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
        syncBeamHingeLayer();
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
            ? `profile\u0000${openFem3DBeamProfileKey(beam)!}`
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
        syncBeamHingeLayer();
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
        ? `profile\u0000${openFem3DBeamProfileKey(beam)!}`
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
      const outsideBoundsScaleStable = Math.abs(scaledNodeRadius(model, visibility) - visualNodeRadiusRef.current) < 1e-12
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
          const nextRadius = scaledNodeRadius(model, visibility);
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
              visibility.nodeNumbers ? String(openFem3DExplodeSourceNodeId(labeledNode.id)) : "",
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
            visibility.nodeNumbers ? String(openFem3DExplodeSourceNodeId(node.id)) : "",
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
            ? createOpenFem3DBeamProfileGeometry(beam, length)
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
              openFem3DProfielTekst(beam, t), "open-fem3d-profile-label",
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
        syncBeamHingeLayer();
        // De peilmaten hangen aan de rand van het model (issue #92): een knoop
        // buiten de oude begrenzing verlegt die rand.
        if (node && (!previousBounds || !previousBounds.containsPoint(new THREE.Vector3(node.x, node.y, node.z)))) {
          replaceOpenFem3DLevelMarks(state, model, structuralGrid, visibility);
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
        plateGeometryById.set(plate.id, createOpenFem3DPlateGeometry(model, plate, byId, visibility.plateDisplay));
        plateGeometryMs += performance.now() - startedAt;
      }
      return plateGeometryById.get(plate.id) ?? null;
    };
    const nodeRadius = scaledNodeRadius(model, visibility);
    visualNodeRadiusRef.current = nodeRadius;
    // Deel onveranderlijke buffers binnen één scène-opbouw. Vooral echte
    // profiel-extrusies en knoopbollen zijn anders bij grote modellen een
    // kostbare herhaling voor ieder element.
    const profileGeometryCache = new Map<string, THREE.BufferGeometry | null>();
    const profileGeometryFor = (beam: OpenFem3DModel["beams"][number], length: number) => {
      // Sleutel en geometrie volgen het profiel, en bij een verlopende staaf
      // (#73) begin → eind: het volume met twee ringen.
      const profileName = openFem3DBeamProfileKey(beam);
      if (!profileName) return null;
      const key = `${profileName}\u0000${length.toFixed(9)}`;
      if (!profileGeometryCache.has(key)) {
        profileGeometryCache.set(key, createOpenFem3DBeamProfileGeometry(beam, length));
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
    const resultLabelStride = openFem3DResultLabelStride(model.beams.length);
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
          ? profileGeometryFor(beam, useBeamInstancing ? 1 : length)
          : null;
        const radius = visibility.profiles ? PROFILE_BEAM_RADIUS_M : ANALYTICAL_BEAM_RADIUS_M;
        const rotation = profileGeometry
          ? memberRotation(delta, beam.rollAngleRad ?? 0)
          : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
        const midpoint = a.clone().add(b).multiplyScalar(0.5);
        if (useBeamInstancing) {
          const key = profileGeometry
            ? `profile\u0000${openFem3DBeamProfileKey(beam)!}`
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
        geometry.add(makeLabel(openFem3DProfielTekst(beam, t), "open-fem3d-profile-label", midpoint));
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
      // In de gekozen plaatweergave (issue #78); dezelfde opbouw als het snelle
      // pad bij het wisselen van stand.
      for (const object of buildPlateLayerObjects(model.plates ?? [], plateGeometryFor, visibility.plateDisplay, plateBatchOwnedGeometries)) {
        geometry.add(object);
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
          visibility.nodeNumbers ? String(openFem3DExplodeSourceNodeId(node.id)) : "",
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
    // Peilmaten: een eigen groep, ook met het stramien uit (issue #92).
    replaceOpenFem3DLevelMarks(state, model, structuralGrid, visibility);
    const conditionGroup = new THREE.Group();
    conditionGroup.userData.openFem3dConditions = true;
    addOpenFem3DConditionMarkers(conditionGroup, conditionModel ?? model, visibility, activeLoadCaseId);
    geometry.add(conditionGroup);
    const beamHinges = beamHingePlacementsFor(model, visibility, nodeRadius);
    geometry.add(buildBeamHingeLayer(beamHinges));
    if (containerRef.current) containerRef.current.dataset.openFem3dBeamHinges = String(beamHinges.length);

    const surfaceLoadGroup = new THREE.Group();
    surfaceLoadGroup.userData.openFem3dSurfaceLoads = true;
    geometry.add(surfaceLoadGroup);
    addSurfaceLoadMarkers(surfaceLoadGroup, plateGeometryFor);

    const loadPanelGroup = new THREE.Group();
    loadPanelGroup.userData.openFem3dLoadPanels = true;
    geometry.add(loadPanelGroup);
    addLoadPanelLayer(loadPanelGroup);
    addEnvelopePanelLayer(loadPanelGroup);

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
      // De waarden bij de opleggingen, voorbij de staart van de pijl. Bij veel
      // opleggingen alleen de grootste 24; de rest blijft in het rapport.
      const reactieGrootte = (reaction: (typeof result.reactions)[number]) =>
        Math.hypot(reaction.fx, reaction.fy, reaction.fz);
      const reactiesMetWaarde = result.reactions.filter((reaction) =>
        reactieGrootte(reaction) > 1e-9 || Math.hypot(reaction.mx, reaction.my, reaction.mz) > 1e-9);
      const reactiesMetLabel = reactiesMetWaarde.length <= 40 ? reactiesMetWaarde
        : [...reactiesMetWaarde].sort((p, q) => reactieGrootte(q) - reactieGrootte(p)).slice(0, 24);
      for (const reaction of reactiesMetLabel) {
        const node = byId.get(reaction.nodeId);
        if (!node) continue;
        // Compact: één decimaal, de eenheid één keer per groep.
        const groep = (waarden: readonly (readonly [string, number])[], eenheid: string) => {
          const delen = waarden.filter(([, value]) => Math.abs(value) >= 0.05)
            .map(([naam, value]) => `${naam} ${value.toFixed(1)}`);
          return delen.length > 0 ? `${delen.join(" · ")} ${eenheid}` : "";
        };
        const delen = [
          groep([["Rx", reaction.fx], ["Ry", reaction.fy], ["Rz", reaction.fz]], "kN"),
          groep([["Mx", reaction.mx], ["My", reaction.my], ["Mz", reaction.mz]], "kNm"),
        ].filter(Boolean);
        if (delen.length === 0) continue;
        const magnitude = reactieGrootte(reaction);
        const plaats = new THREE.Vector3(node.x, node.y, node.z);
        if (magnitude > 1e-9 && maxForce > 0) {
          const richting = new THREE.Vector3(reaction.fx, reaction.fy, reaction.fz).normalize();
          plaats.addScaledVector(richting, -(0.45 + 1.1 * magnitude / maxForce) - 0.15);
        }
        geometry.add(makeLabel(delen.join(" · "), "open-fem3d-result-label open-fem3d-reaction-label", plaats));
      }
    }

    let resultDiagramCount = 0;
    if (result && (visibility.axialForce || visibility.shearY || visibility.shearZ ||
      visibility.torsion || visibility.momentY || visibility.momentZ || visibility.groundPressure)) {
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
      const { maxima, height: diagramHeight } = diagramScale(model, result, activeDiagrams);
      // Alleen de lijnen; hun getallen (en N en T op het staafmidden) staan in
      // een eigen labellaag (buildDiagramLabelLayer), die Waarden, de stand en
      // de selectie volgt zonder de scène opnieuw op te bouwen.
      for (const beam of model.beams) {
        const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
        const force = forceByMember.get(beam.id);
        if (!start || !end || !force) continue;
        const a = new THREE.Vector3(start.x, start.y, start.z);
        const b = new THREE.Vector3(end.x, end.y, end.z);
        const axes = memberAxes(b.clone().sub(a), beam.rollAngleRad ?? 0);
        for (const component of activeDiagrams) {
          const style = DIAGRAM_STYLE[component];
          if (addResultDiagram(
            geometry, beam.id, a, b, style.direction(axes), diagramPoints(result, component, force),
            maxima.get(component) ?? 0, diagramHeight,
            { symbol: style.symbol, unit: style.unit, color: style.color },
            diagramBatches?.get(component),
          )) resultDiagramCount += 1;
        }
      }
      diagramBatches?.forEach((batch) => flushResultDiagramBatch(geometry, batch));
    }
    // Gronddruk (#106): waar de grond bij alleen druk loslaat, een grijze
    // stippellijn net onder de staaf (aan de kant van de grond, anders valt
    // zij achter de staaf weg), met "geen contact" erboven bij het langste
    // stuk: onder de staaf staan de waarden van de gronddruklijn.
    let liftedRunCount = 0;
    if (result?.bedding && visibility.groundPressure) {
      const liftedPoints: THREE.Vector3[] = [];
      const { height: pressureHeight } = diagramScale(model, result, ["groundPressure"]);
      for (const [beamIndex, beam] of model.beams.entries()) {
        const member = result.bedding.find((item) => item.memberId === beam.id);
        const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
        if (!member || !start || !end) continue;
        const runs = openFem3DBeddingLiftedRuns(member);
        if (runs.length === 0) continue;
        const a = new THREE.Vector3(start.x, start.y, start.z);
        const b = new THREE.Vector3(end.x, end.y, end.z);
        const down = DIAGRAM_STYLE.groundPressure.direction(memberAxes(b.clone().sub(a), beam.rollAngleRad ?? 0));
        const onder = down.clone().multiplyScalar(0.05 * pressureHeight);
        for (const [from, to] of runs) liftedPoints.push(a.clone().lerp(b, from).add(onder), a.clone().lerp(b, to).add(onder));
        liftedRunCount += runs.length;
        const longest = runs.reduce((best, run) => run[1] - run[0] > best[1] - best[0] ? run : best);
        if (resultLabelVisible(beam.id, beamIndex)) {
          geometry.add(makeLabel(t("openFem3d.bedding.canvasLifted"),
            "open-fem3d-result-label open-fem3d-bedding-lifted-label",
            a.clone().lerp(b, (longest[0] + longest[1]) / 2).addScaledVector(down, -0.3 * pressureHeight)));
        }
      }
      if (liftedPoints.length > 0) {
        const lifted = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(liftedPoints),
          new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.12, gapSize: 0.08 }),
        );
        lifted.computeLineDistances();
        lifted.userData = { openFem3dResult: true, openFem3dBeddingLifted: true, pickable: false };
        geometry.add(lifted);
      }
    }
    if (containerRef.current) {
      containerRef.current.dataset.openFem3dResultDiagrams = String(resultDiagramCount);
      containerRef.current.dataset.openFem3dBeddingLifted = String(liftedRunCount);
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
      containerRef.current.dataset.openFem3dPlateDisplay = visibility.plateDisplay;
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

  // De getallen bij de snedekrachtlijnen als eigen laag (issue #95), na de
  // scène-opbouw hierboven: Waarden, de stand of een andere selectie bouwen
  // alleen deze laag opnieuw. Na een volledige opbouw (die de laag weggooit)
  // komt hij terug; anders blijft hij staan zolang model, resultaat, de zes
  // lijnen, de instelling en de geselecteerde staven gelijk zijn. Een groot
  // plan wordt vóór elke labelindeling uitgedund (thinDiagramLabelLayer).
  // Diagnose: data-open-fem3d-diagram-labels = het aantal labels in het plan,
  // data-open-fem3d-diagram-label-elements = het aantal elementen in de DOM.
  const diagramLabelLayerRef = useRef<{
    layer: DiagramLabelLayer; model: OpenFem3DModel; result: OpenFem3DSolveResult; layers: string;
    labels: OpenFem3DDiagramLabels; selected: string;
  } | null>(null);
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const { geometry } = state;
    const labels = diagramLabels ?? DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS;
    const layers = OPEN_FEM_3D_FORCE_LAYERS.filter((layer) => visibility[layer]).join(",");
    const shown = result && layers && labels.show ? result : null;
    const selectedBeamIds = shown ? openFem3DDiagramLabelSelection(selection) : [];
    const selected = selectedBeamIds.join(",");
    const current = diagramLabelLayerRef.current;
    const reusable = shown !== null && current !== null && current.layer.group.parent === geometry && current.model === model
      && current.result === shown && current.layers === layers && sameOpenFem3DDiagramLabels(current.labels, labels)
      && current.selected === selected;
    if (reusable) return;
    let changed = false;
    if (current) {
      changed = current.layer.group.parent === geometry;
      current.layer.group.removeFromParent();
      disposeObject3D(current.layer.group);
      diagramLabelLayerRef.current = null;
    }
    state.beforeLabels = undefined;
    let layer: DiagramLabelLayer | null = null;
    if (shown) {
      const startedAt = performance.now();
      layer = buildDiagramLabelLayer(model, shown, visibility, labels, selectedBeamIds);
      geometry.add(layer.group);
      diagramLabelLayerRef.current = { layer, model, result: shown, layers, labels, selected };
      const thinned = layer;
      if (thinned.thinned) state.beforeLabels = (scene, container) => thinDiagramLabelLayer(scene, container, thinned);
      changed = true;
      if (containerRef.current) containerRef.current.dataset.openFem3dDiagramLabelLayerMs = (performance.now() - startedAt).toFixed(2);
    }
    if (containerRef.current) {
      containerRef.current.dataset.openFem3dDiagramLabels = String(layer?.specs.length ?? 0);
      containerRef.current.dataset.openFem3dDiagramLabelsThinned = String(layer?.thinned ?? false);
    }
    // Alleen de labels: de laag bestaat uit CSS-labels en verandert niets aan
    // het WebGL-beeld; een WebGL-render hier was bij elke klik en stand overbodig.
    if (changed) renderOpenFem3DLabels(state, containerRef.current);
    if (containerRef.current) containerRef.current.dataset.openFem3dDiagramLabelElements = String(layer ? diagramLabelElements(layer) : 0);
  }, [model, conditionModel, visibility, structuralGrid, result, utilizations, activeLoadCaseId, loadCaseTypes, diagramLabels, selection]);

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
        // De grootste verplaatsing (knoop of veld, dezelfde maat als de
        // statusregel) als label op de vervormde plek.
        const grootste = openFem3DMaximumDisplacement(model, shown);
        if (grootste && grootste.valueM > 0) {
          const [x, y, z] = grootste.point;
          const [ux, uy, uz] = grootste.displacement;
          built.group.add(makeLabel(
            `u max ${resultValue(grootste.valueM * 1000)} mm`,
            "open-fem3d-result-label open-fem3d-displacement-label",
            new THREE.Vector3(x + ux * scale, y + uy * scale, z + uz * scale),
          ));
        }
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
    if (changed) {
      state.renderer.render(state.scene, state.camera);
      // De laag draagt het label "u max": ook de labels opnieuw plaatsen.
      renderOpenFem3DLabels(state, containerRef.current);
    }
  }, [model, conditionModel, visibility, structuralGrid, result, utilizations, activeLoadCaseId, deformationDisplay]);

  // Platen: rekennet ("Mesh") en resultaatcontour in een eigen laag. Deze
  // effect volgt op elke (her)bouw hierboven, zodat de gewone plaatvlakken na
  // een herbouw opnieuw doorzichtig worden als er een contour ligt.
  const plateOverlayInputRef = useRef<{
    model: OpenFem3DModel; visibility: OpenFem3DVisibility; result: OpenFem3DSolveResult | null | undefined;
    plateMesh: typeof plateMesh; plateQuantity: typeof plateQuantity; deformationDisplay: typeof deformationDisplay;
  } | null>(null);
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    // Aantal getekende symbooldelen van de randopleggingen (gebundeld per vorm).
    const writeEdgeSupportGlyphs = (overlayGroup: THREE.Object3D) => {
      if (!containerRef.current) return;
      containerRef.current.dataset.openFem3dEdgeSupportGlyphs = String(
        overlayGroup.getObjectByName(OPEN_FEM_3D_PLATE_EDGE_SUPPORTS_NAME)?.children.reduce((count, child) =>
          count + (child instanceof THREE.InstancedMesh ? child.count : child instanceof THREE.Mesh ? 1 : 0), 0) ?? 0);
      // Platen op bedding met een arcering (#107).
      containerRef.current.dataset.openFem3dPlateBedding = String(
        overlayGroup.getObjectByName(OPEN_FEM_3D_PLATE_BEDDING_NAME)?.userData.openFem3dPlateBeddingCount ?? 0);
    };
    // De regelaars Knopen en Opleggingen (issue #82) raken van deze laag
    // hoogstens de randopleggingen. Heeft de scène daarvoor het snelle pad
    // genomen (de plaatvlakken zijn niet herbouwd), dan blijft de laag staan:
    // schuiven bouwt geen rekennet of contour opnieuw op. Bij Opleggingen
    // wordt alleen de groep met randopleggingen vervangen (een fractie van
    // het net en de contour van een grote plaat).
    const vorige = plateOverlayInputRef.current;
    plateOverlayInputRef.current = { model, visibility, result, plateMesh, plateQuantity, deformationDisplay };
    const snelPad = symbolScalePathRef.current;
    const zonderSchaal = (zicht: OpenFem3DVisibility) => ({ ...zicht, nodeSizePercent: 0, supportSizePercent: 0 });
    const bestaand = state.scene.getObjectByName("open-fem3d-plate-overlay");
    // Alleen de section box anders (issue #86): net en contour blijven staan;
    // de doos knipt ze met dezelfde clipping planes als de rest.
    const zonderDoos = (zicht: OpenFem3DVisibility) => ({ ...zicht, sectionBox: DEFAULT_OPEN_FEM_3D_SECTION_BOX });
    if (vorige && vorige.model === model && vorige.result === result && vorige.plateMesh === plateMesh
      && vorige.plateQuantity === plateQuantity && vorige.deformationDisplay === deformationDisplay
      && vorige.visibility.sectionBox !== visibility.sectionBox
      && sameOpenFem3DVisibility(zonderDoos(vorige.visibility), zonderDoos(visibility))) {
      return;
    }
    if (vorige && vorige.model === model && vorige.result === result && vorige.plateMesh === plateMesh
      && vorige.plateQuantity === plateQuantity && vorige.deformationDisplay === deformationDisplay
      && snelPad?.visibility === visibility
      && sameOpenFem3DVisibility(zonderSchaal(vorige.visibility), zonderSchaal(visibility))
      && bestaand !== undefined) {
      if (snelPad.kind === "support" && vorige.visibility.supportSizePercent !== visibility.supportSizePercent) {
        // De randopleggingen en de arcering van platen op bedding (#107) volgen de regelaar.
        const oude = [OPEN_FEM_3D_PLATE_EDGE_SUPPORTS_NAME, OPEN_FEM_3D_PLATE_BEDDING_NAME]
          .map((naam) => bestaand.getObjectByName(naam)).filter((groep) => groep !== undefined);
        for (const oud of oude) {
          oud.removeFromParent();
          disposeObject3D(oud);
        }
        const nieuwe = visibility.supports ? [
          buildOpenFem3DPlateEdgeSupports(model, visibility.supportSizePercent),
          buildOpenFem3DPlateBeddingHatch(model, visibility.supportSizePercent, visibility.plateDisplay),
        ].filter((groep) => groep !== null) : [];
        for (const nieuw of nieuwe) bestaand.add(nieuw);
        if (oude.length > 0 || nieuwe.length > 0) {
          state.renderer.render(state.scene, state.camera);
          writeEdgeSupportGlyphs(bestaand);
        }
      }
      return;
    }
    const previous = bestaand;
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
      // De elementlijnen alleen in de plaatweergave mesh (issue #78), op het middenvlak.
      showMesh: OPEN_FEM_3D_PLATE_DISPLAY_STYLES[visibility.plateDisplay].showMesh,
      showPlates: visibility.plates, showSupports: visibility.supports,
      // Randopleggingen volgen de regelaar Opleggingen (issue #82).
      supportSizePercent: visibility.supportSizePercent,
      // De arcering van een plaat op bedding (#107) ligt onder de getekende onderzijde.
      plateDisplay: visibility.plateDisplay,
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
      // Knopen zonder contact in de contour Gronddruk of Zakking (#107).
      containerRef.current.dataset.openFem3dPlateLifted = String(overlay.liftedNodes);
      containerRef.current.dataset.openFem3dPlateOverlay =
        overlay.contourShown ? `contour:${plateQuantity}`
          : overlay.group.children.some((child) => child.userData.openFem3dPlateMesh !== undefined) ? "mesh" : "none";
    }
    writeEdgeSupportGlyphs(overlay.group);
  }, [model, conditionModel, visibility, structuralGrid, result, utilizations, activeLoadCaseId, plateMesh, plateQuantity, deformationDisplay]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (selectionRenderedWithModelRef.current === selection) {
      selectionRenderedWithModelRef.current = undefined;
      if (containerRef.current) containerRef.current.dataset.openFem3dSelectionMs = "0.00";
      return;
    }
    // De markering van een opbouw geldt alleen voor de eerstvolgende run. Bleef
    // hij staan (opbouw zonder selectiewissel, bijvoorbeeld een andere
    // plaatweergave), dan sloeg een latere terugkeer naar die selectie
    // (vaak: niets geselecteerd) het oplichten over en bleef de vorige
    // selectie oranje.
    selectionRenderedWithModelRef.current = undefined;
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
    if (aimedViewTokenRef.current === false || aimedViewTokenRef.current !== viewRequest?.token) {
      // Een nieuw lintaanzicht (of het eerste beeld). Kijkrichting en up per
      // lintaanzicht staan in openFem3dViewCube.ts; de view cube gebruikt
      // dezelfde functie voor zijn vlakken.
      aimedViewTokenRef.current = viewRequest?.token;
      const { richting, up } = openFem3DAanzichtRichting(viewRequest?.kind ?? "iso");
      aimOpenFem3DCamera(state, modelRef.current, visibility, richting, up);
    } else {
      // Alleen Passend beeld: de huidige kijkrichting en up blijven. Het
      // gemelde aanzicht (viewRequest.kind) is na een draai of een klik op de
      // kubus een benadering ("front" voor Achter) en geen richting.
      fitOpenFem3DCamera(state, modelRef.current, visibility);
    }
    cameraChangeRef.current?.(openFem3DCameraStateVan(state));
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
    // Ook de schaal van een parallelle view (orthoHalfHeight), zie pasOpenFem3DCameraStateToe.
    pasOpenFem3DCameraStateToe(state, cameraRequest.state);
    cameraChangeRef.current?.(openFem3DCameraStateVan(state));
    cameraViewChangeRef.current?.(openFem3DViewFromCamera(state.camera.position, state.controls.target));
    state.renderer.render(state.scene, state.camera);
    renderOpenFem3DLabels(state, containerRef.current);
    writeCameraDiagnostics(containerRef.current, state);
    nodeSnapPrewarmRef.current?.();
  }, [cameraRequest?.token]);

  // Vlaknamen, labels en menu van de view cube in de gekozen taal.
  useEffect(() => {
    const viewCube = sceneRef.current?.viewCube;
    if (!viewCube) return;
    viewCube.zetTeksten(viewCubeTeksten);
    if (viewCubeMenuRef.current) viewCube.zetMenu(viewCubeMenuRef.current(viewCubeTeksten));
  }, [viewCubeTeksten]);

  // Zichtbaarheid `viewCube`: verborgen = geen kubus, geen menu en geen
  // gereserveerde plek meer voor labels (die worden opnieuw ingedeeld).
  useEffect(() => {
    const state = sceneRef.current;
    if (!state?.viewCube) return;
    state.viewCube.toon(visibility.viewCube);
    renderOpenFem3DLabels(state, containerRef.current);
  }, [visibility.viewCube]);

  return <div
    className={`open-fem3d-canvas open-fem3d-tool-${tool} ${tool.startsWith("support:") || tool.startsWith("spring:") || tool === "addMemberLoad" || tool === "addPointLoad" || tool === "loadPanelSpan" || tool === "beamEndHinge" ? "open-fem3d-tool-support" : ""}`}
    ref={containerRef}
    aria-label={`3D raamwerk · ${viewRequest?.kind ?? currentView}`}
  />;
}
