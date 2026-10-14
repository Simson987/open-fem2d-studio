import {
  parseOpenFem3DModel,
  type OpenFem3DEnvelopePanel,
  type OpenFem3DModel,
  type OpenFem3DNode,
} from "./openFem3dModel";
import {
  addOpenFem3DLoadPanel,
  analyseOpenFem3DLoadPanel,
  defaultOpenFem3DLoadPanelSpan,
  openFem3DLoadPanelGeometry,
  OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M,
} from "./openFem3dLoadPanels";
import type { StructuralGrid } from "../fem/femTypes";

type Point2 = readonly [number, number];
type Point3 = readonly [number, number, number];

const subtract = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const position = (node: OpenFem3DNode): Point3 => [node.x, node.y, node.z];
const area = (loop: readonly Point2[]) => Math.abs(loop.reduce((sum, a, i) => {
  const b = loop[(i + 1) % loop.length];
  return sum + a[0] * b[1] - b[0] * a[1];
}, 0) / 2);

function pointOnSegment(p: Point2, a: Point2, b: Point2, tolerance: number): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <= tolerance;
}

function strictlyInside(p: Point2, loop: readonly Point2[], tolerance: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if (pointOnSegment(p, a, b, tolerance)) return false;
    if ((a[1] > p[1]) !== (b[1] > p[1])
      && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2, tolerance: number): boolean {
  const orient = (p: Point2, q: Point2, r: Point2) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if ([a, b].some((p) => pointOnSegment(p, c, d, tolerance))
    || [c, d].some((p) => pointOnSegment(p, a, b, tolerance))) return true;
  const x = orient(a, b, c), y = orient(a, b, d), u = orient(c, d, a), v = orient(c, d, b);
  return x * y < 0 && u * v < 0;
}

function boundariesCross(a: readonly Point2[], b: readonly Point2[], tolerance: number): boolean {
  return a.some((start, i) => b.some((other, j) =>
    segmentsCross(start, a[(i + 1) % a.length], other, b[(j + 1) % b.length], tolerance)));
}

/** Vlak, openingen en buitenwaartse normaal; de oppervlakte is netto. */
export function openFem3DEnvelopePanelGeometry(model: OpenFem3DModel, panel: OpenFem3DEnvelopePanel) {
  const outer = openFem3DLoadPanelGeometry(model, {
    id: panel.id, nodeIds: panel.nodeIds, distribution: panel.distribution, spanDirection: panel.spanDirection,
  });
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const project = (nodeId: number): Point2 => {
    const node = byId.get(nodeId);
    if (!node) throw new Error(`Schilpaneel ${panel.id}: knoop ${nodeId} bestaat niet.`);
    const relative = subtract(position(node), outer.origin);
    const distance = Math.abs(dot(relative, outer.normal));
    if (distance > OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M) {
      throw new Error(`Opening van schilpaneel ${panel.id} ligt buiten het vlak.`);
    }
    return [dot(relative, outer.axisU), dot(relative, outer.axisV)];
  };
  const tolerance = OPEN_FEM_3D_LOAD_PANEL_TOLERANCE_M * 1e-3;
  const holes = (panel.openings ?? []).map((opening) => {
    openFem3DLoadPanelGeometry(model, { id: opening.id, nodeIds: opening.nodeIds, distribution: "twoWay" });
    const polygon = opening.nodeIds.map(project);
    if (polygon.some((point) => !strictlyInside(point, outer.polygon, tolerance))
      || boundariesCross(polygon, outer.polygon, tolerance)) {
      throw new Error(`Opening ${opening.id} van schilpaneel ${panel.id} ligt niet volledig binnen de buitenrand.`);
    }
    return { id: opening.id, polygon, areaM2: area(polygon) };
  });
  for (let i = 0; i < holes.length; i += 1) for (let j = i + 1; j < holes.length; j += 1) {
    if (boundariesCross(holes[i].polygon, holes[j].polygon, tolerance)
      || strictlyInside(holes[i].polygon[0], holes[j].polygon, tolerance)
      || strictlyInside(holes[j].polygon[0], holes[i].polygon, tolerance)) {
      throw new Error(`Openingen ${holes[i].id} en ${holes[j].id} van schilpaneel ${panel.id} overlappen.`);
    }
  }
  const netAreaM2 = outer.areaM2 - holes.reduce((sum, hole) => sum + hole.areaM2, 0);
  if (!(netAreaM2 > 0)) throw new Error(`Schilpaneel ${panel.id} heeft geen netto oppervlak.`);
  const corners = panel.nodeIds.map((id) => position(byId.get(id)!));
  let oriented: Point3 = [0, 0, 0];
  for (let i = 1; i + 1 < corners.length; i += 1) {
    oriented = cross(subtract(corners[i], corners[0]), subtract(corners[i + 1], corners[0]));
    if (Math.hypot(...oriented) > 1e-12) break;
  }
  const length = Math.hypot(...oriented);
  const sign = panel.flipOuterSide ? -1 : 1;
  const outwardNormal: Point3 = oriented.map((value) => value === 0 ? 0 : sign * value / length) as [number, number, number];
  return { outer, holes, netAreaM2, outwardNormal };
}

export function addOpenFem3DEnvelopePanel(
  model: OpenFem3DModel,
  values: Omit<OpenFem3DEnvelopePanel, "id">,
): OpenFem3DModel {
  const id = (model.envelopePanels ?? []).reduce((max, panel) => Math.max(max, panel.id), 0) + 1;
  const candidate = { ...values, id, ...(values.distribution === "oneWay" && !values.spanDirection
    ? { spanDirection: defaultOpenFem3DLoadPanelSpan(model, values.nodeIds) } : {}) };
  const parsed = parseOpenFem3DModel({ ...model, envelopePanels: [...(model.envelopePanels ?? []), candidate] });
  openFem3DEnvelopePanelGeometry(parsed, parsed.envelopePanels![parsed.envelopePanels!.length - 1]);
  return { ...model, envelopePanels: parsed.envelopePanels };
}

/** Rechthoek tussen twee stramienassen en twee levels, of een volledig gevel-/dakvlak. */
export function addOpenFem3DEnvelopePanelFromGrid(
  model: OpenFem3DModel,
  grid: StructuralGrid,
  input: { plane: "xy" | "xz" | "yz"; fixed: number; first: [number, number]; second: [number, number] },
): OpenFem3DModel {
  const axes = input.plane === "xy" ? [grid.xAxes, grid.yAxes ?? [], grid.zAxes]
    : input.plane === "xz" ? [grid.xAxes, grid.zAxes, grid.yAxes ?? []]
      : [grid.yAxes ?? [], grid.zAxes, grid.xAxes];
  const positions = axes.map((lines) => new Set(lines.map((line) => line.position / 1000)));
  if (!positions[2].has(input.fixed)
    || !input.first.every((value) => positions[0].has(value))
    || !input.second.every((value) => positions[1].has(value))
    || !(input.first[0] < input.first[1] && input.second[0] < input.second[1])) {
    throw new Error("Kies twee verschillende stramienassen en levels voor het schilpaneel.");
  }
  const corners = [
    [input.first[0], input.second[0]], [input.first[1], input.second[0]],
    [input.first[1], input.second[1]], [input.first[0], input.second[1]],
  ].map(([a, b]) => input.plane === "xy" ? { x: a, y: b, z: input.fixed }
    : input.plane === "xz" ? { x: a, y: input.fixed, z: b }
      : { x: input.fixed, y: a, z: b });
  const nodes = model.nodes.slice();
  let nextId = nodes.reduce((max, node) => Math.max(max, node.id), 0) + 1;
  const nodeIds = corners.map((corner) => {
    const existing = nodes.find((node) => Math.hypot(
      node.x - corner.x, node.y - corner.y, node.z - corner.z) < 1e-6);
    if (existing) return existing.id;
    const id = nextId++;
    nodes.push({ id, ...corner });
    return id;
  });
  return addOpenFem3DEnvelopePanel({ ...model, nodes }, {
    nodeIds, type: input.plane === "xy" ? "roof" : "facade", distribution: "twoWay",
  });
}

export function updateOpenFem3DEnvelopePanel(
  model: OpenFem3DModel, id: number, patch: Partial<Omit<OpenFem3DEnvelopePanel, "id">>,
): OpenFem3DModel {
  if (!(model.envelopePanels ?? []).some((panel) => panel.id === id)) throw new Error(`Schilpaneel ${id} bestaat niet.`);
  const parsed = parseOpenFem3DModel({ ...model, envelopePanels: model.envelopePanels!.map((panel) =>
    panel.id === id ? {
      ...panel, ...patch,
      ...((patch.distribution ?? panel.distribution) === "oneWay" && !(patch.spanDirection ?? panel.spanDirection)
        ? { spanDirection: defaultOpenFem3DLoadPanelSpan(model, patch.nodeIds ?? panel.nodeIds) } : {}),
    } : panel) });
  openFem3DEnvelopePanelGeometry(parsed, parsed.envelopePanels!.find((panel) => panel.id === id)!);
  return { ...model, envelopePanels: parsed.envelopePanels };
}

export function removeOpenFem3DEnvelopePanel(model: OpenFem3DModel, id: number): OpenFem3DModel {
  return { ...model, envelopePanels: (model.envelopePanels ?? []).filter((panel) => panel.id !== id) };
}

/** De afdrachtcontrole is dezelfde als voor een handmatig belastingvlak. */
export function openFem3DEnvelopePanelSupportWarnings(model: OpenFem3DModel, panel: OpenFem3DEnvelopePanel): string[] {
  try {
    return analyseOpenFem3DLoadPanel(model, {
      id: panel.id, nodeIds: panel.nodeIds, openings: panel.openings, q: 1, direction: "normal",
      distribution: panel.distribution, spanDirection: panel.spanDirection,
    }).warnings;
  } catch (cause) {
    return [cause instanceof Error ? cause.message : String(cause)];
  }
}

/**
 * Maak voor een geval een gewoon belastingvlak uit de gebouwschil. De
 * afdracht gebruikt daarmee dezelfde rekenregels als een handmatig vlak.
 * `q` bij normal werkt positief naar buiten; bij gravity positief omlaag
 * per m² horizontale projectie; bij verticalSurface positief omlaag per m²
 * werkelijk vlak (ook bij verticale gevels).
 */
export function addOpenFem3DEnvelopePanelLoad(
  model: OpenFem3DModel, panelId: number, caseId: number, q: number,
  direction: "normal" | "gravity" | "verticalSurface",
): OpenFem3DModel {
  const panel = (model.envelopePanels ?? []).find((candidate) => candidate.id === panelId);
  if (!panel) throw new Error(`Schilpaneel ${panelId} bestaat niet.`);
  const geometry = openFem3DEnvelopePanelGeometry(model, panel);
  const signedQ = direction === "normal" && dot(geometry.outwardNormal, geometry.outer.normal) < 0 ? -q : q;
  return addOpenFem3DLoadPanel(model, panel.nodeIds, {
    caseId, q: signedQ, direction, distribution: panel.distribution,
    spanDirection: panel.spanDirection,
    openings: panel.openings,
  });
}
