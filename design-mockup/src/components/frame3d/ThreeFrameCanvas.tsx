import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addFrame3DPlate, addFrame3DPlateOpening, frame3DLoadCaseId, splitFrame3DBeam, type Frame3DModel } from "./frame3dModel";
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
import { createFrame3DProfileGeometry, frame3DProfileSection } from "./frame3dProfileGeometry";
import { frame3DMaximumDisplacementM, frame3DMemberDisplacementStations } from "./frame3dDisplacement";
import {
  frame3DSelectionContains,
  toggleFrame3DSelection,
  type Frame3DSelection,
} from "./frame3dSelection";
import type { Frame3DCameraState } from "./frame3dViewSets";
import { createFrame3DPlateGeometry } from "./frame3dPlateGeometry";

// De analytische knoop is een punt, maar in de editor moet hij ook op afstand
// goed aanklikbaar en herkenbaar blijven. De staaf loopt tot het middelpunt van
// deze bol en verdwijnt er dus ruim in: ook onder een schuine kijkhoek ontstaat
// er nergens een zichtbare kier tussen staaf en knoop.
const ANALYTICAL_BEAM_RADIUS_M = 0.035;
const PROFILE_BEAM_RADIUS_M = 0.12;

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
  viewRequest?: { kind: Frame3DView; token: number };
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
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
  axisLabels: CSS2DObject[];
}

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

function makeLabel(text: string, className: string, position: THREE.Vector3): CSS2DObject {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  const label = new CSS2DObject(element);
  label.position.copy(position);
  label.center.set(0, 1);
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
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
  fillGeometry.computeVertexNormals();
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

  // De tekst toont de echte eindwaarden, maar staat iets binnen de staaf. Op
  // een gedeelde knoop zouden alle staafeindlabels anders exact over elkaar
  // vallen. De diagramlijn zelf blijft gewoon tot beide knopen doorlopen.
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

function addDashedLine(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, color = 0x7c8da0) {
  const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
  const material = new THREE.LineDashedMaterial({ color, dashSize: 0.22, gapSize: 0.12, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  group.add(line);
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

  for (const axis of grid.xAxes) {
    const x = axis.position / 1000;
    addDashedLine(group, new THREE.Vector3(x, yMin, baseZ), new THREE.Vector3(x, yMax, baseZ));
    group.add(makeLabel(axis.label, "frame3d-grid-label", new THREE.Vector3(x, yMin, baseZ)));
  }
  for (const axis of grid.yAxes ?? []) {
    const y = axis.position / 1000;
    addDashedLine(group, new THREE.Vector3(xMin, y, baseZ), new THREE.Vector3(xMax, y, baseZ));
    group.add(makeLabel(axis.label, "frame3d-grid-label", new THREE.Vector3(xMin, y, baseZ)));
  }
  for (const level of grid.zAxes) {
    const z = level.position / 1000;
    const corners = [
      new THREE.Vector3(xMin, yMin, z), new THREE.Vector3(xMax, yMin, z),
      new THREE.Vector3(xMax, yMax, z), new THREE.Vector3(xMin, yMax, z),
    ];
    corners.forEach((corner, index) => addDashedLine(group, corner, corners[(index + 1) % corners.length], 0x94a3b8));
    group.add(makeLabel(level.label, "frame3d-grid-label frame3d-level-label", new THREE.Vector3(xMin, yMin, z)));
  }
  if (grid.zAxes.length === 0) {
    addDashedLine(group, new THREE.Vector3(xMin, yMin, zMin), new THREE.Vector3(xMin, yMin, zMax), 0x94a3b8);
  }
}

function resultScale(model: Frame3DModel, result: Frame3DSolveResult): number {
  const box = new THREE.Box3();
  model.nodes.forEach((node) => box.expandByPoint(new THREE.Vector3(node.x, node.y, node.z)));
  const modelSize = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
  const maxDisplacement = frame3DMaximumDisplacementM(model, result);
  return maxDisplacement > 1e-15 ? Math.min(10_000, modelSize * 0.12 / maxDisplacement) : 1;
}

export default function ThreeFrameCanvas({ model, conditionModel, onChange, tool, selection, onSelect, fitToken, visibility, viewRequest, structuralGrid, result, utilizations = [], activeLoadCaseId, cameraRequest, onCameraChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const modelRef = useRef(model);
  modelRef.current = model;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const plateDraftRef = useRef<number[]>([]);
  const openingPlateRef = useRef<number | null>(null);
  const cameraChangeRef = useRef(onCameraChange);
  cameraChangeRef.current = onCameraChange;
  useEffect(() => {
    plateDraftRef.current = [];
    openingPlateRef.current = tool === "addOpening" && selection?.type === "plate" ? selection.id : null;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
    sceneRef.current = { scene, camera, renderer, labelRenderer, controls, geometry, grid, axes, axisLabels };

    // Damping staat uit, dus continu renderen levert alleen CPU/GPU-belasting op.
    // Teken uitsluitend na camera-, formaat- of modelwijzigingen. Dat houdt ook
    // meerdere geopende 3D-vensters responsief.
    const renderScene = () => {
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      cameraChangeRef.current?.({
        position: camera.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
        up: camera.up.toArray() as [number, number, number],
      });
    };
    controls.addEventListener("change", renderScene);

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
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
                  -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const intersection = raycaster.intersectObjects(geometry.children, true)[0];
      let hit: THREE.Object3D | undefined = intersection?.object;
      while (hit && hit !== geometry && typeof hit.userData.type !== "string") hit = hit.parent ?? undefined;
      const type = hit?.userData.type;
      const id = hit?.userData.id;
      const activeTool = toolRef.current;
      const current = modelRef.current;
      if (activeTool === "addNode") {
        const point = new THREE.Vector3();
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        if (raycaster.ray.intersectPlane(plane, point)) {
          const snap = (value: number) => Math.round(value * 10) / 10;
          const x = snap(point.x), y = snap(point.y), z = 0;
          const existing = current.nodes.find((node) => Math.hypot(node.x - x, node.y - y, node.z - z) < 1e-7);
          if (existing) selectRef.current({ type: "node", id: existing.id });
          else {
            const newId = Math.max(0, ...current.nodes.map((node) => node.id)) + 1;
            changeRef.current({ ...current, nodes: [...current.nodes, { id: newId, x, y, z }] });
            selectRef.current({ type: "node", id: newId });
          }
        }
      } else if (activeTool === "addBeam") {
        if (type === "node" && typeof id === "number") {
          const start = selectionRef.current?.type === "node" ? selectionRef.current.id : null;
          if (start === null || start === id) selectRef.current({ type: "node", id });
          else {
            const duplicate = current.beams.some((beam) =>
              beam.startNodeId === start && beam.endNodeId === id ||
              beam.startNodeId === id && beam.endNodeId === start);
            if (!duplicate) {
              const beamId = Math.max(0, ...current.beams.map((beam) => beam.id)) + 1;
              changeRef.current({
                ...current,
                beams: [...current.beams, {
                  id: beamId,
                  startNodeId: start,
                  endNodeId: id,
                  material: "S235",
                  profileName: "IPE 200",
                }],
              });
              selectRef.current({ type: "beam", id: beamId });
            }
          }
        }
      } else if (activeTool === "addPlate" || activeTool === "addOpening") {
        if (type === "node" && typeof id === "number") {
          const draft = plateDraftRef.current;
          if (draft.length >= 3 && id === draft[0]) {
            try {
              if (activeTool === "addPlate") {
                const next = addFrame3DPlate(current, draft, { thicknessM: 0.2, material: "C30/37" });
                changeRef.current(next);
                selectRef.current({ type: "plate", id: Math.max(...(next.plates ?? []).map((plate) => plate.id)) });
              } else if (openingPlateRef.current !== null) {
                const next = addFrame3DPlateOpening(current, openingPlateRef.current, draft);
                changeRef.current(next);
                selectRef.current({ type: "plate", id: openingPlateRef.current });
              }
            } finally {
              plateDraftRef.current = [];
            }
          } else if (!draft.includes(id)) {
            plateDraftRef.current = [...draft, id];
            selectRef.current({ type: "multi", nodeIds: [...plateDraftRef.current], beamIds: [] });
          }
        }
      } else if (activeTool === "addSubNode") {
        if (type === "beam" && typeof id === "number" && intersection) {
          const beam = current.beams.find((item) => item.id === id);
          const start = beam && current.nodes.find((node) => node.id === beam.startNodeId);
          const end = beam && current.nodes.find((node) => node.id === beam.endNodeId);
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
      down = null;
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.removeEventListener("change", renderScene);
      controls.dispose();
      disposeGroup(geometry);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      axisLabels.forEach((label) => label.element.remove());
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const { geometry } = state;
    disposeGroup(geometry);
    state.grid.visible = visibility.grid;
    state.axes.visible = visibility.axes;
    state.axisLabels.forEach((label) => { label.visible = visibility.axes; });
    const byId = new Map(model.nodes.map((node) => [node.id, node]));
    const nodeRadius = visualNodeRadius(model);
    const utilizationByMember = new Map(utilizations.map((value) => [value.beamId, value]));
    for (const beam of model.beams) {
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
        const color = frame3DSelectionContains(selection, "beam", beam.id)
          ? 0xd97706
          : utilizationClass ? FRAME_3D_UTILIZATION_COLORS[utilizationClass] : 0x2563eb;
        const profileGeometry = visibility.profiles
          ? createFrame3DProfileGeometry(beam.profileName, length)
          : null;
        const radius = visibility.profiles ? PROFILE_BEAM_RADIUS_M : ANALYTICAL_BEAM_RADIUS_M;
        const mesh = new THREE.Mesh(
          profileGeometry ?? new THREE.CylinderGeometry(radius, radius, length, visibility.profiles ? 24 : 12),
          new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04 }),
        );
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.copy(profileGeometry
          ? memberRotation(delta, beam.rollAngleRad ?? 0)
          : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
        mesh.userData = { type: "beam", id: beam.id };
        if (profileGeometry) {
          // Een dunne rand maakt lijf, flenzen en holle kokers ook bij een
          // witte achtergrond als echte doorsnede leesbaar.
          mesh.add(new THREE.LineSegments(
            new THREE.EdgesGeometry(profileGeometry, 28),
            new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.42 }),
          ));
        }
        geometry.add(mesh);
        if (utilization) {
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
      if (visibility.beamNumbers) {
        const midpoint = a.clone().add(b).multiplyScalar(0.5).addScaledVector(axes.ey, 0.3);
        geometry.add(makeLabel(`(${beam.id})`, "frame3d-beam-number", midpoint));
      }
      if (visibility.profiles && beam.profileName) {
        const midpoint = a.clone().add(b).multiplyScalar(0.5).addScaledVector(axes.ez, -0.3);
        geometry.add(makeLabel(beam.profileName, "frame3d-profile-label", midpoint));
      }
    }
    if (visibility.plates) {
      for (const plate of model.plates ?? []) {
        const built = createFrame3DPlateGeometry(model, plate);
        if (!built) continue;
        const selected = frame3DSelectionContains(selection, "plate", plate.id);
        const mesh = new THREE.Mesh(built.geometry, new THREE.MeshStandardMaterial({
          color: selected ? 0xd97706 : 0x94a3b8,
          roughness: 0.78,
          metalness: 0.01,
          transparent: true,
          opacity: selected ? 0.88 : 0.7,
          side: THREE.DoubleSide,
        }));
        mesh.position.copy(built.position);
        mesh.quaternion.copy(built.quaternion);
        mesh.userData = { type: "plate", id: plate.id };
        mesh.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(built.geometry, 22),
          new THREE.LineBasicMaterial({ color: selected ? 0x92400e : 0x475569, transparent: true, opacity: 0.78 }),
        ));
        geometry.add(mesh);
      }
    }
    for (const node of model.nodes) {
      if (visibility.nodes) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(nodeRadius, 24, 16),
          new THREE.MeshStandardMaterial({
            color: frame3DSelectionContains(selection, "node", node.id) ? 0xd97706 : 0x334155,
            roughness: 0.5,
            metalness: 0.06,
          }),
        );
        mesh.position.set(node.x, node.y, node.z);
        mesh.userData = { type: "node", id: node.id };
        geometry.add(mesh);
        // De zichtbare bol blijft klein zoals in 2D; een transparante grotere
        // bol geeft hem een comfortabele klikzone zonder het beeld te vullen.
        const hitTarget = new THREE.Mesh(
          new THREE.SphereGeometry(nodeRadius * 2.6, 12, 8),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        hitTarget.position.copy(mesh.position);
        hitTarget.userData = { type: "node", id: node.id };
        geometry.add(hitTarget);
      }
      if (visibility.nodeNumbers || visibility.nodeCoordinates) {
        const parts = [
          visibility.nodeNumbers ? String(node.id) : "",
          visibility.nodeCoordinates ? `(${node.x}, ${node.y}, ${node.z}) m` : "",
        ].filter(Boolean);
        geometry.add(makeLabel(parts.join(" · "), "frame3d-node-label", new THREE.Vector3(node.x, node.y, node.z)));
      }
    }
    if (visibility.structuralGrid && structuralGrid) addStructuralGrid(geometry, model, structuralGrid);
    addFrame3DConditionMarkers(geometry, conditionModel ?? model, visibility, activeLoadCaseId);

    if (visibility.loads) {
      for (const load of model.surfaceLoads ?? []) {
        if (activeLoadCaseId !== undefined && frame3DLoadCaseId(load) !== activeLoadCaseId) continue;
        const plate = (model.plates ?? []).find((item) => item.id === load.plateId);
        const built = plate && createFrame3DPlateGeometry(model, plate);
        if (!built) continue;
        const vector = new THREE.Vector3(load.qx, load.qy, load.qz);
        const magnitude = vector.length();
        if (magnitude <= 1e-12) continue;
        const direction = vector.normalize();
        const length = 0.7;
        const arrow = new THREE.ArrowHelper(direction, built.centroid.clone().addScaledVector(direction, -length), length, 0x0284c7, 0.22, 0.12);
        arrow.traverse((child) => { child.userData = { type: "surfaceLoad", id: load.id }; });
        geometry.add(arrow);
        geometry.add(makeLabel(
          `q = ${resultValue(magnitude)} kN/m²`,
          "frame3d-result-label frame3d-surface-load-label",
          built.centroid.clone().addScaledVector(built.normal, 0.12),
        ));
      }
    }

    if (result && visibility.deformation) {
      const scale = resultScale(model, result);
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
            const profile = length > 1e-10 ? createFrame3DProfileGeometry(beam.profileName, length) : null;
            if (!profile) continue;
            const deformed = new THREE.Mesh(profile, new THREE.MeshStandardMaterial({
              color: 0xdc2626, transparent: true, opacity: 0.48, depthWrite: false, roughness: 0.65,
            }));
            deformed.position.copy(a).add(b).multiplyScalar(0.5);
            deformed.quaternion.copy(memberRotation(delta, beam.rollAngleRad ?? 0));
            geometry.add(deformed);
          }
        } else {
          geometry.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0xdc2626, linewidth: 2 }),
          ));
        }
      }
    }

    if (result && visibility.reactions) {
      const maxForce = result.reactions.reduce((maximum, value) =>
        Math.max(maximum, Math.hypot(value.fx, value.fy, value.fz)), 0);
      for (const reaction of result.reactions) {
        const node = byId.get(reaction.nodeId);
        const magnitude = Math.hypot(reaction.fx, reaction.fy, reaction.fz);
        if (!node || magnitude <= 1e-12 || maxForce <= 0) continue;
        const direction = new THREE.Vector3(reaction.fx, reaction.fy, reaction.fz).normalize();
        const length = 0.45 + 1.1 * magnitude / maxForce;
        const origin = new THREE.Vector3(node.x, node.y, node.z).addScaledVector(direction, -length);
        geometry.add(new THREE.ArrowHelper(direction, origin, length, 0x16a34a, Math.min(0.28, length * 0.28), Math.min(0.16, length * 0.16)));
      }
    }

    if (result && (visibility.axialForce || visibility.shearY || visibility.shearZ ||
      visibility.torsion || visibility.momentY || visibility.momentZ)) {
      const forceByMember = new Map(result.memberForces.map((force) => [force.memberId, force]));
      const activeDiagrams = (Object.keys(DIAGRAM_STYLE) as DiagramComponent[])
        .filter((component) => visibility[component]);
      const maxima = new Map(activeDiagrams.map((component) => [
        component,
        result.memberForces.reduce((maximum, force) =>
          Math.max(maximum, ...diagramPoints(result, component, force).map((point) => Math.abs(point.value))), 0),
      ]));
      const modelBox = new THREE.Box3().setFromPoints(model.nodes.map((node) => new THREE.Vector3(node.x, node.y, node.z)));
      const diagramHeight = Math.max(0.35, Math.min(3, modelBox.getSize(new THREE.Vector3()).length() * 0.085));
      for (const beam of model.beams) {
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
          );
        }
        const max = (a: number, b: number) => Math.max(Math.abs(a), Math.abs(b)).toFixed(2);
        const parts = [
          visibility.axialForce ? `N ${max(force.nStartKn, force.nEndKn)} kN` : "",
          visibility.torsion ? `T ${max(force.torsionStartKnm, force.torsionEndKnm)} kNm` : "",
        ].filter(Boolean);
        if (parts.length > 0) {
          const midpoint = a.clone().add(b).multiplyScalar(0.5);
          geometry.add(makeLabel(parts.join(" · "), "frame3d-result-label", midpoint));
        }
      }
    }
    state.renderer.render(state.scene, state.camera);
    state.labelRenderer.render(state.scene, state.camera);
  }, [model, conditionModel, selection, visibility, structuralGrid, result, utilizations, activeLoadCaseId]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
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
    const distance = hasGeometry ? fittedCameraDistance(state.camera, box, direction) : 4;
    state.controls.target.copy(center);
    state.camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    state.camera.near = Math.max(0.001, distance / 10_000);
    state.camera.far = Math.max(1_000, distance * 100);
    state.camera.updateProjectionMatrix();
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
    state.labelRenderer.render(state.scene, state.camera);
  }, [
    fitToken, viewRequest?.token, viewRequest?.kind,
    model.nodes.map((node) => `${node.id}:${node.x}:${node.y}:${node.z}`).join("|"),
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
  }, [cameraRequest?.token]);

  return <div className={`frame3d-canvas frame3d-tool-${tool}`} ref={containerRef} aria-label="3D raamwerk" />;
}
