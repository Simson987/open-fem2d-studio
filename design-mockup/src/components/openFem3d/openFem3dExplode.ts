import type { OpenFem3DModel, OpenFem3DNode, OpenFem3DPlateBoundarySegment } from "./openFem3dModel";
import { openFem3DLevelsByHeight, type OpenFem3DLevel } from "./openFem3dLevels";
import type { OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import type { OpenFem3DSelection } from "./openFem3dSelection";
import type { StructuralGrid } from "../fem/femTypes";

/**
 * Hoe de weergave uit elkaar gaat (alleen weergave; de rekenkern krijgt
 * altijd het echte model):
 *  - "levels": elk level schuift omhoog met zijn volgnummer x de afstand;
 *    staven tussen levels rekken mee.
 *  - "elementTypes": per elementsoort, in de volgorde van de krachtsafdracht
 *    van onder naar boven: opleggingen 0, kolommen 1 x de afstand, liggers
 *    2 x en platen 3 x (issue #198). Elk element schuift als geheel.
 */
export type OpenFem3DExplodeMode = "levels" | "elementTypes";
export const OPEN_FEM_3D_EXPLODE_MODES: readonly OpenFem3DExplodeMode[] = ["levels", "elementTypes"];

/** A view-only vertical separation, expressed in metres per step (level or element type). */
export interface OpenFem3DExplode {
  mode: OpenFem3DExplodeMode;
  amountM: number;
}

export const DEFAULT_OPEN_FEM_3D_EXPLODE: OpenFem3DExplode = { mode: "levels", amountM: 0 };
export const MAX_OPEN_FEM_3D_EXPLODE_M = 10;
/** De afstand die de schakelaar (lint, menu van de view cube) aanzet. */
export const OPEN_FEM_3D_EXPLODE_TOGGLE_M = 2;

export function isOpenFem3DExplodeMode(value: unknown): value is OpenFem3DExplodeMode {
  return value === "levels" || value === "elementTypes";
}

export function normalizeOpenFem3DExplode(value: unknown): OpenFem3DExplode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_OPEN_FEM_3D_EXPLODE;
  const raw = value as Record<string, unknown>;
  return {
    mode: isOpenFem3DExplodeMode(raw.mode) ? raw.mode : "levels",
    amountM: typeof raw.amountM === "number" && Number.isFinite(raw.amountM)
      ? Math.max(0, Math.min(MAX_OPEN_FEM_3D_EXPLODE_M, raw.amountM)) : 0,
  };
}

/** Aan/uit (lint, menu van de view cube): de modus blijft. */
export function toggleOpenFem3DExplode(explode: OpenFem3DExplode): OpenFem3DExplode {
  return { mode: explode.mode, amountM: explode.amountM > 0 ? 0 : OPEN_FEM_3D_EXPLODE_TOGGLE_M };
}

/**
 * De explode uit `explode` van gui_configure_3d_view: `mode` ("levels" of
 * "elementTypes") en `amount_mm` (0 ... 10 000), elk optioneel; wat ontbreekt
 * blijft. Gooit bij een onbekend veld of een ongeldige waarde, zodat een fout
 * niets verandert.
 */
export function openFem3DExplodeFromCommand(args: unknown, current: OpenFem3DExplode): OpenFem3DExplode {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("`explode` moet een object zijn");
  const raw = args as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter((key) => key !== "mode" && key !== "amount_mm");
  if (unknownKeys.length > 0) throw new Error(`explode kent ${unknownKeys.join(", ")} niet; toegestaan: mode, amount_mm`);
  if (raw.mode !== undefined && !isOpenFem3DExplodeMode(raw.mode)) throw new Error("explode.mode moet levels of elementTypes zijn");
  if (raw.amount_mm !== undefined && (typeof raw.amount_mm !== "number" || !Number.isFinite(raw.amount_mm)
    || raw.amount_mm < 0 || raw.amount_mm > MAX_OPEN_FEM_3D_EXPLODE_M * 1000)) {
    throw new Error(`explode.amount_mm moet een getal in mm zijn van 0 tot ${MAX_OPEN_FEM_3D_EXPLODE_M * 1000}`);
  }
  return {
    mode: (raw.mode as OpenFem3DExplodeMode | undefined) ?? current.mode,
    amountM: raw.amount_mm === undefined ? current.amountM : (raw.amount_mm as number) / 1000,
  };
}

// -- Per elementsoort ---------------------------------------------------------

/** De stap per elementsoort (x de afstand). */
export const OPEN_FEM_3D_EXPLODE_TYPE_STEP = Object.freeze({ support: 0, column: 1, beam: 2, plate: 3 });

/** Kolom: overwegend verticaal (|dz| groter dan de horizontale lengte); anders een ligger (ook een schoor onder 45 graden). */
export function openFem3DExplodeIsColumn(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return Math.abs(b.z - a.z) > Math.hypot(b.x - a.x, b.y - a.y) + 1e-12;
}

/**
 * Een knoop die bij meer soorten hoort (de kop van een kolom draagt ook een
 * ligger) staat per soort op een andere hoogte. De knoop zelf (zijn id) staat
 * bij de laagste soort waar hij bij hoort, met zijn oplegging en knooplasten;
 * de andere soorten krijgen een weergaveknoop met een negatieve id die de
 * bronknoop en de stap bevat: -(4 x id + stap). Nooit in het echte model.
 */
export function openFem3DExplodeGhostNodeId(sourceId: number, step: number): number {
  return -(4 * sourceId + step);
}

/** De echte knoop achter een (weergave)knoop-id: een gewone id blijft. */
export function openFem3DExplodeSourceNodeId(id: number): number {
  return id < 0 ? Math.floor(-id / 4) : id;
}

/** Een selectie op weergaveknopen (kiezen, kader, label) -> dezelfde selectie op de echte knopen. */
export function openFem3DExplodeSourceSelection(selection: OpenFem3DSelection): OpenFem3DSelection {
  if (!selection) return selection;
  if (selection.type === "node") {
    return selection.id < 0 ? { type: "node", id: openFem3DExplodeSourceNodeId(selection.id) } : selection;
  }
  if (selection.type === "multi" && selection.nodeIds.some((id) => id < 0)) {
    return { ...selection, nodeIds: [...new Set(selection.nodeIds.map(openFem3DExplodeSourceNodeId))] };
  }
  return selection;
}

type NodeIdLists = {
  nodeIds: number[];
  boundary?: OpenFem3DPlateBoundarySegment[];
  openings?: { nodeIds: number[]; boundary?: OpenFem3DPlateBoundarySegment[] }[];
};

function segmentNodeIds(segment: OpenFem3DPlateBoundarySegment): number[] {
  return segment.kind === "arc"
    ? [segment.startNodeId, segment.controlNodeId, segment.endNodeId] : [segment.startNodeId, segment.endNodeId];
}

function surfaceNodeIds(surface: NodeIdLists): number[] {
  const ids = [...surface.nodeIds];
  for (const segment of surface.boundary ?? []) ids.push(...segmentNodeIds(segment));
  for (const opening of surface.openings ?? []) {
    ids.push(...opening.nodeIds);
    for (const segment of opening.boundary ?? []) ids.push(...segmentNodeIds(segment));
  }
  return ids;
}

function mapSegments(segments: OpenFem3DPlateBoundarySegment[], map: (id: number) => number): OpenFem3DPlateBoundarySegment[] {
  return segments.map((segment) => segment.kind === "arc"
    ? { ...segment, startNodeId: map(segment.startNodeId), controlNodeId: map(segment.controlNodeId), endNodeId: map(segment.endNodeId) }
    : { ...segment, startNodeId: map(segment.startNodeId), endNodeId: map(segment.endNodeId) });
}

function mapSurface<T extends NodeIdLists>(surface: T, map: (id: number) => number): T {
  return {
    ...surface,
    nodeIds: surface.nodeIds.map(map),
    ...(surface.boundary ? { boundary: mapSegments(surface.boundary, map) } : {}),
    ...(surface.openings ? { openings: surface.openings.map((opening) => ({
      ...opening, nodeIds: opening.nodeIds.map(map),
      ...(opening.boundary ? { boundary: mapSegments(opening.boundary, map) } : {}),
    })) } : {}),
  };
}

/**
 * De stap per knoop: de laagste soort waar hij bij hoort. Belastingvlakken
 * horen bij de liggers die ze belasten, gevelvlakken (bekleding) bij de
 * platen. Een losse knoop: 0.
 */
export function openFem3DExplodeNodeSteps(model: OpenFem3DModel): Map<number, number> {
  const step = OPEN_FEM_3D_EXPLODE_TYPE_STEP;
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const home = new Map<number, number>();
  const mark = (id: number, value: number) => home.set(id, Math.min(home.get(id) ?? Infinity, value));
  for (const support of model.supports ?? []) mark(support.nodeId, step.support);
  for (const beam of model.beams) {
    const a = byId.get(beam.startNodeId), b = byId.get(beam.endNodeId);
    if (!a || !b) continue;
    const value = openFem3DExplodeIsColumn(a, b) ? step.column : step.beam;
    mark(beam.startNodeId, value);
    mark(beam.endNodeId, value);
  }
  for (const plate of model.plates ?? []) surfaceNodeIds(plate).forEach((id) => mark(id, step.plate));
  for (const panel of model.loadPanels ?? []) surfaceNodeIds(panel).forEach((id) => mark(id, step.beam));
  for (const panel of model.envelopePanels ?? []) surfaceNodeIds(panel).forEach((id) => mark(id, step.plate));
  const result = new Map<number, number>();
  for (const node of model.nodes) {
    const value = home.get(node.id);
    result.set(node.id, value !== undefined && Number.isFinite(value) ? value : 0);
  }
  return result;
}

function explodedByElementType(model: OpenFem3DModel, amountM: number): OpenFem3DModel {
  const step = OPEN_FEM_3D_EXPLODE_TYPE_STEP;
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const home = openFem3DExplodeNodeSteps(model);
  const ghosts = new Map<number, OpenFem3DNode>();
  const at = (value: number) => (id: number): number => {
    const node = byId.get(id);
    if (!node || (home.get(id) ?? 0) === value) return id;
    const ghostId = openFem3DExplodeGhostNodeId(id, value);
    if (!ghosts.has(ghostId)) {
      const ghost: OpenFem3DNode = { ...node, id: ghostId, z: node.z + value * amountM };
      delete ghost.levelId;
      ghosts.set(ghostId, ghost);
    }
    return ghostId;
  };
  const beams = model.beams.map((beam) => {
    const a = byId.get(beam.startNodeId), b = byId.get(beam.endNodeId);
    if (!a || !b) return beam;
    const map = at(openFem3DExplodeIsColumn(a, b) ? step.column : step.beam);
    const startNodeId = map(beam.startNodeId), endNodeId = map(beam.endNodeId);
    return startNodeId === beam.startNodeId && endNodeId === beam.endNodeId ? beam : { ...beam, startNodeId, endNodeId };
  });
  const plates = model.plates?.map((plate) => mapSurface(plate, at(step.plate)));
  const loadPanels = model.loadPanels?.map((panel) => mapSurface(panel, at(step.beam)));
  const envelopePanels = model.envelopePanels?.map((panel) => mapSurface(panel, at(step.plate)));
  const nodes = model.nodes.map((node) => {
    const value = home.get(node.id) ?? 0;
    return value === 0 ? node : { ...node, z: node.z + value * amountM };
  });
  return {
    ...model,
    nodes: [...nodes, ...ghosts.values()],
    beams,
    ...(plates ? { plates } : {}),
    ...(loadPanels ? { loadPanels } : {}),
    ...(envelopePanels ? { envelopePanels } : {}),
  };
}

function heightRank(model: OpenFem3DModel, levels: readonly OpenFem3DLevel[]) {
  const sortedLevels = openFem3DLevelsByHeight(levels);
  const heights = sortedLevels.length > 1
    ? [...new Set(sortedLevels.map((level) => level.position / 1000))]
    : [...new Set(model.nodes.map((node) => node.z))].sort((a, b) => a - b);
  const levelIndex = new Map(sortedLevels
    .map((level) => [level.id, heights.findIndex((height) => height === level.position / 1000)] as const)
    .filter((entry) => entry[1] >= 0));
  const rank = (z: number) => {
    let index = 0;
    for (let i = 1; i < heights.length; i += 1) {
      if (z < heights[i] - 1e-6) break;
      index = i;
    }
    return index;
  };
  return { heights, levelIndex, rank };
}

/** Mesh nodes from the solver have no level id; use the floor at or below z. */
export function openFem3DExplodedMesh(
  mesh: OpenFem3DPlateMesh | null, model: OpenFem3DModel,
  levels: readonly OpenFem3DLevel[], explode: OpenFem3DExplode,
): OpenFem3DPlateMesh | null {
  if (!mesh || !(explode.amountM > 0)) return mesh;
  if (explode.mode === "elementTypes") {
    // Alles van het rekennet hoort bij de platen (3 x de afstand). De
    // elementen verwijzen ook naar modelknopen (hoeken, randen): die staan
    // hier met hun eigen id op plaathoogte, zodat de plaatlaag het net heel
    // tekent; in het tekenvlak staat de modelknoop zelf bij zijn laagste soort.
    const dz = OPEN_FEM_3D_EXPLODE_TYPE_STEP.plate * explode.amountM;
    const own = new Set(mesh.nodes.map((node) => node.id));
    const byId = new Map(model.nodes.map((node) => [node.id, node]));
    const shared = new Set<number>();
    for (const element of mesh.elements) for (const id of element.nodeIds) if (!own.has(id) && byId.has(id)) shared.add(id);
    return { ...mesh, nodes: [
      ...mesh.nodes.map((node) => ({ ...node, z: node.z + dz })),
      ...[...shared].map((id) => { const node = byId.get(id)!; return { id, x: node.x, y: node.y, z: node.z + dz }; }),
    ] };
  }
  const { heights, rank } = heightRank(model, levels);
  if (heights.length < 2) return mesh;
  return { ...mesh, nodes: mesh.nodes.map((node) => ({ ...node, z: node.z + rank(node.z) * explode.amountM })) };
}

/** Level guides and peilmaten follow the same visual separation. */
export function openFem3DExplodedGrid(grid: StructuralGrid | undefined, explode: OpenFem3DExplode): StructuralGrid | undefined {
  if (!grid || !(explode.amountM > 0) || explode.mode !== "levels" || grid.zAxes.length < 2) return grid;
  const heights = [...new Set(grid.zAxes.map((axis) => axis.position))].sort((a, b) => a - b);
  return { ...grid, zAxes: grid.zAxes.map((axis) => ({
    ...axis, position: axis.position + heights.indexOf(axis.position) * explode.amountM * 1000,
  })) };
}

/**
 * Per level: only node positions change. Member ends therefore stretch between levels;
 * plates, attached loads, symbols, selections and result geometry share the
 * same displaced nodes. Per element type: see explodedByElementType; member
 * loads keep their position because every member keeps its length. The
 * solver always receives the original model.
 */
export function openFem3DExplodedModel(
  model: OpenFem3DModel, levels: readonly OpenFem3DLevel[], explode: OpenFem3DExplode,
): OpenFem3DModel {
  if (!(explode.amountM > 0) || model.nodes.length === 0) return model;
  if (explode.mode === "elementTypes") return explodedByElementType(model, explode.amountM);
  const { heights, levelIndex, rank } = heightRank(model, levels);
  if (heights.length < 2) return model;
  const nodes = model.nodes.map((node) => ({
    ...node,
    z: node.z + (levelIndex.get(node.levelId ?? "") ?? rank(node.z)) * explode.amountM,
  }));
  const before = new Map(model.nodes.map((node) => [node.id, node]));
  const after = new Map(nodes.map((node) => [node.id, node]));
  const scaleByBeam = new Map(model.beams.map((beam) => {
    const a = before.get(beam.startNodeId), b = before.get(beam.endNodeId);
    const c = after.get(beam.startNodeId), d = after.get(beam.endNodeId);
    const oldLength = a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
    const newLength = c && d ? Math.hypot(c.x - d.x, c.y - d.y, c.z - d.z) : oldLength;
    return [beam.id, oldLength > 1e-9 ? newLength / oldLength : 1] as const;
  }));
  return {
    ...model,
    nodes,
    ...(model.memberLoads ? { memberLoads: model.memberLoads.map((load) => ({ ...load,
      startPositionM: load.startPositionM * (scaleByBeam.get(load.beamId) ?? 1),
      endPositionM: load.endPositionM * (scaleByBeam.get(load.beamId) ?? 1),
    })) } : {}),
    ...(model.memberPointLoads ? { memberPointLoads: model.memberPointLoads.map((load) => ({ ...load,
      positionM: load.positionM * (scaleByBeam.get(load.beamId) ?? 1),
    })) } : {}),
  };
}

/**
 * Het resultaat voor de weergave: het rekennet mee uit elkaar, en de
 * weergaveknopen van "elementTypes" krijgen de verplaatsing van hun
 * bronknoop, zodat de vervormde staaf heel blijft.
 */
export function openFem3DExplodedResult(
  result: OpenFem3DSolveResult | null | undefined, model: OpenFem3DModel, displayModel: OpenFem3DModel,
  levels: readonly OpenFem3DLevel[], explode: OpenFem3DExplode,
): OpenFem3DSolveResult | null | undefined {
  if (!result || !(explode.amountM > 0)) return result;
  const ghostIds = explode.mode === "elementTypes" ? displayModel.nodes.filter((node) => node.id < 0).map((node) => node.id) : [];
  if (!result.plateMesh && ghostIds.length === 0) return result;
  let displacements = result.displacements;
  if (ghostIds.length > 0) {
    const bySource = new Map(result.displacements.map((value) => [value.nodeId, value]));
    displacements = [...result.displacements];
    for (const id of ghostIds) {
      const source = bySource.get(openFem3DExplodeSourceNodeId(id));
      if (source) displacements.push({ ...source, nodeId: id });
    }
  }
  return {
    ...result, displacements,
    ...(result.plateMesh ? { plateMesh: openFem3DExplodedMesh(result.plateMesh, model, levels, explode)! } : {}),
  };
}
