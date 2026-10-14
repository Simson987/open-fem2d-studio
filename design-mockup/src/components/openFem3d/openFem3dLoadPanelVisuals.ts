/**
 * Weergave van lastvlakken in het 3D-tekenvlak: een licht doorzichtig,
 * dubbelzijdig gevuld vlak in de kleur van het belastinggeval met zijn
 * omtrek, pijlen in de lastrichting en — bij een belastingvlak dat in één
 * richting afdraagt — een dubbele pijl voor de overspanning. De meetkunde
 * komt uit dezelfde functies als de afdracht (`openFem3dLoadPanels`,
 * `openFem3dLoadSurfaces`), zodat wat je ziet ook is wat er gerekend wordt.
 *
 * Klikken gaat door het vlak heen (`pickThrough`): een staaf, knoop of plaat
 * eronder blijft gewoon aanklikbaar. Alleen een klik op een plek waar verder
 * niets ligt, selecteert het vlak zelf.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { openFem3DLoadCaseId, type OpenFem3DLoadPanel, type OpenFem3DModel } from "./openFem3dModel";
import { openFem3DLoadPanelForcePerArea, openFem3DLoadPanelGeometry } from "./openFem3dLoadPanels";
import {
  OPEN_FEM_3D_LOAD_SURFACE_OPACITY,
  OPEN_FEM_3D_LOAD_SURFACE_SELECTED_OPACITY,
  openFem3DLoadPanelSurface,
  type OpenFem3DLoadSurface,
} from "./openFem3dLoadSurfaces";

const INVALID_COLOR = 0xdc2626;
const SPAN_COLOR = 0x9333ea;

export interface OpenFem3DLoadPanelMarkerText {
  label: (panel: OpenFem3DLoadPanel) => string;
  title: (panel: OpenFem3DLoadPanel) => string;
  onSelect: (panelId: number, additive: boolean) => void;
  /** Kleur van het belastinggeval van het vlak. */
  color: (panel: OpenFem3DLoadPanel) => number;
}

/** Arceerlijnen onder 45° op de u-as, geknipt op de (mogelijk niet-convexe) veelhoek. */
function hatchSegments(polygon: readonly [number, number][], spacing: number): [number, number][] {
  const direction: [number, number] = [Math.SQRT1_2, Math.SQRT1_2];
  const normal: [number, number] = [-Math.SQRT1_2, Math.SQRT1_2];
  const offsets = polygon.map((p) => p[0] * normal[0] + p[1] * normal[1]);
  const minimum = Math.min(...offsets), maximum = Math.max(...offsets);
  const segments: [number, number][] = [];
  for (let offset = minimum + spacing / 2; offset < maximum; offset += spacing) {
    const base: [number, number] = [normal[0] * offset, normal[1] * offset];
    const hits: number[] = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      const da = (a[0] * normal[0] + a[1] * normal[1]) - offset;
      const db = (b[0] * normal[0] + b[1] * normal[1]) - offset;
      if ((da > 0) === (db > 0) || da === db) continue;
      const t = da / (da - db);
      const point: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      hits.push((point[0] - base[0]) * direction[0] + (point[1] - base[1]) * direction[1]);
    }
    hits.sort((x, y) => x - y);
    for (let index = 0; index + 1 < hits.length; index += 2) {
      segments.push(
        [base[0] + hits[index] * direction[0], base[1] + hits[index] * direction[1]],
        [base[0] + hits[index + 1] * direction[0], base[1] + hits[index + 1] * direction[1]],
      );
    }
  }
  return segments;
}

/**
 * Het gevulde vlak en zijn omtrek als Three-objecten. `userData` bepaalt de
 * selectie: `pickThrough` laat klikken door het vlak heen, de omtrek is niet
 * klikbaar maar kleurt wel mee bij selecteren.
 */
export function openFem3DLoadSurfaceObjects(
  surface: OpenFem3DLoadSurface,
  color: number,
  selection: { type: "loadPanel" | "surfaceLoad" | "envelopePanel"; id: number },
): THREE.Object3D[] {
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(surface.positions, 3));
  fillGeometry.computeBoundingSphere();
  const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: OPEN_FEM_3D_LOAD_SURFACE_OPACITY, side: THREE.DoubleSide, depthWrite: false,
  }));
  fill.renderOrder = 2;
  fill.userData = {
    ...selection, pickThrough: true, openFem3dLoadSurface: true,
    baseOpacity: OPEN_FEM_3D_LOAD_SURFACE_OPACITY, selectionOpacity: OPEN_FEM_3D_LOAD_SURFACE_SELECTED_OPACITY,
    selectionColor: 0xf59e0b,
  };
  const outlines = surface.outlines.map((points) => {
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))),
      new THREE.LineBasicMaterial({ color }),
    );
    outline.userData = { ...selection, pickable: false, selectionColor: 0xb45309 };
    return outline;
  });
  return [fill, ...outlines];
}

function panelLabel(
  text: string, title: string, position: THREE.Vector3, panelId: number,
  onSelect: (panelId: number, additive: boolean) => void,
): CSS2DObject {
  const element = document.createElement("span");
  element.className = "open-fem3d-result-label open-fem3d-load-panel-label";
  element.textContent = text;
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("title", title);
  element.style.pointerEvents = "auto";
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    onSelect(panelId, event.shiftKey || event.ctrlKey || event.metaKey);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(panelId, event.shiftKey || event.ctrlKey || event.metaKey);
  });
  const label = new CSS2DObject(element);
  label.position.copy(position);
  label.center.set(0, 1);
  return label;
}

/**
 * Teken de belastingvlakken van het actieve belastinggeval in `group`. Een
 * vlak waarvan de meetkunde ongeldig is (scheef getrokken, zelfsnijdend)
 * krijgt alleen een rode omtrek: zichtbaar, maar zonder schijnzekerheid.
 */
export function addOpenFem3DLoadPanelMarkers(
  group: THREE.Group,
  model: OpenFem3DModel,
  activeLoadCaseId: number | undefined,
  text: OpenFem3DLoadPanelMarkerText,
): void {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const panels = (model.loadPanels ?? []).filter((panel) =>
    activeLoadCaseId === undefined || openFem3DLoadCaseId(panel) === activeLoadCaseId);
  for (const panel of panels) {
    const corners = panel.nodeIds.map((id) => nodeById.get(id)).filter((node) => node !== undefined);
    if (corners.length < 3) continue;
    const color = text.color(panel);
    const surface = openFem3DLoadPanelSurface(model, panel, nodeById);
    if (!surface) {
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(corners.map((node) => new THREE.Vector3(node.x, node.y, node.z))),
        new THREE.LineBasicMaterial({ color: INVALID_COLOR }),
      );
      outline.userData = { type: "loadPanel", id: panel.id, pickable: false, selectionColor: 0xb45309 };
      group.add(outline);
      const middle = corners.reduce((sum, node) => sum.add(new THREE.Vector3(node.x, node.y, node.z)), new THREE.Vector3())
        .multiplyScalar(1 / corners.length);
      group.add(panelLabel(text.label(panel), text.title(panel), middle, panel.id, text.onSelect));
      continue;
    }
    for (const object of openFem3DLoadSurfaceObjects(surface, color, { type: "loadPanel", id: panel.id })) group.add(object);
    group.add(panelLabel(text.label(panel), text.title(panel), new THREE.Vector3(...surface.anchor), panel.id, text.onSelect));

    const geometry = openFem3DLoadPanelGeometry(model, panel, nodeById);
    const origin = new THREE.Vector3(...geometry.origin);
    const axisU = new THREE.Vector3(...geometry.axisU), axisV = new THREE.Vector3(...geometry.axisV);
    const to3D = (p: readonly [number, number]) => origin.clone().addScaledVector(axisU, p[0]).addScaledVector(axisV, p[1]);
    const spacing = Math.max(0.2, geometry.sizeM / 12);
    const hatch = hatchSegments(geometry.polygon, spacing).map(to3D);
    if (hatch.length > 0) {
      const lines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(hatch),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }),
      );
      lines.userData = { type: "loadPanel", id: panel.id, pickable: false, selectionColor: 0xd97706 };
      group.add(lines);
    }

    let force: [number, number, number] | null = null;
    try {
      force = openFem3DLoadPanelForcePerArea(panel, geometry);
    } catch {
      force = null;
    }
    const arrowLength = Math.min(1.2, Math.max(0.3, geometry.sizeM * 0.15));
    if (force && Math.hypot(...force) > 0) {
      const direction = new THREE.Vector3(...force).normalize();
      const centroid = new THREE.Vector3(...geometry.centroid);
      const anchors = [centroid];
      const step = Math.max(1, Math.floor(corners.length / 4));
      for (let index = 0; index < geometry.polygon.length && anchors.length < 5; index += step) {
        anchors.push(centroid.clone().lerp(to3D(geometry.polygon[index]), 0.55));
      }
      for (const anchor of anchors) {
        const arrow = new THREE.ArrowHelper(direction, anchor.clone().addScaledVector(direction, -arrowLength),
          arrowLength, color, arrowLength * 0.28, arrowLength * 0.16);
        // Net als de vulling: een pijl steelt geen klik van een ligger in het
        // vlak (een middenligger loopt vaak precies onder de middelste pijl).
        arrow.traverse((child) => { child.userData = { type: "loadPanel", id: panel.id, pickThrough: true }; });
        group.add(arrow);
      }
    }
    if (panel.distribution === "oneWay") {
      // Dubbele pijl in het vlak, iets boven het vlak aan de kant van de pijlen.
      const extentU = Math.max(...geometry.polygon.map((p) => p[0])) - Math.min(...geometry.polygon.map((p) => p[0]));
      const half = Math.max(0.3, extentU * 0.3);
      const lift = force ? new THREE.Vector3(...force).normalize().multiplyScalar(-0.03 * arrowLength) : new THREE.Vector3();
      const centre = new THREE.Vector3(...geometry.centroid).add(lift);
      for (const sign of [1, -1]) {
        const arrow = new THREE.ArrowHelper(axisU.clone().multiplyScalar(sign), centre, half, SPAN_COLOR, half * 0.22, half * 0.12);
        arrow.traverse((child) => { child.userData = { type: "loadPanel", id: panel.id, pickable: false, openFem3dSpanArrow: true }; });
        group.add(arrow);
      }
    }
  }
}
