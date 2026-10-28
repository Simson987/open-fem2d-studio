/**
 * Plaatsen op een object in 3D (issues #76 en #77). Een oplegging, veer of
 * puntlast komt op het doel van een klik:
 *
 *  - een bestaande knoop;
 *  - een staaf: voor een oplegging of veer wordt de staaf op die plek
 *    gesplitst zoals bij de tussenknoop (`splitOpenFem3DBeam`: lasten en
 *    eindscharnieren blijven goed verdeeld) en krijgt de nieuwe knoop de
 *    voorwaarde; een puntlast wordt een staafpuntlast op die plek, zonder
 *    splitsen. Op een staafeinde (t = 0 of 1) is het doel de eindknoop;
 *  - een plaat: een nieuwe knoop in het middenvlak (het punt loodrecht op het
 *    plaatvlak geprojecteerd), met het level van de plaat, niet in een
 *    opening of buiten de plaat. Het rekennet neemt een modelknoop in het
 *    veld als hard punt mee (openFem3dPlateMesh.ts);
 *  - een vrij punt (het werkvlak): de knoop die daar al ligt, of een nieuwe.
 *
 * Elke plaatsing levert één nieuw model, dus één stap ongedaan maken. Zuiver:
 * geen React, geen Three; dezelfde functies voor het tekenvlak en de API.
 */
import {
  addOpenFem3DMemberPointLoad,
  addOpenFem3DNodalLoad,
  splitOpenFem3DBeam,
  type OpenFem3DModel,
  type OpenFem3DNodalLoadComponents,
} from "./openFem3dModel";
import { classifyOpenFem3DPlatePoint, openFem3DPlatePlane } from "./openFem3dPlateMesh";
import type { OpenFem3DSingleSelection } from "./openFem3dSelection";

export interface OpenFem3DPoint { x: number; y: number; z: number }

/** Een plek op een staaf: als afstand vanaf de beginknoop (m) of als fractie t van de lengte (0–1). */
export type OpenFem3DBeamSpot = { beamId: number; positionM: number } | { beamId: number; t: number };

/** Waar een oplegging of veer komt. */
export type OpenFem3DPlacementTarget =
  | { nodeId: number }
  /** Een vrij punt, bijvoorbeeld op het werkvlak (m). */
  | { position: OpenFem3DPoint }
  | OpenFem3DBeamSpot
  /** Een punt op of bij een plaat; het wordt op het middenvlak geprojecteerd (m). */
  | { plateId: number; point: OpenFem3DPoint };

/** Waar een puntlast komt: een knoop (knooplast) of een plek op een staaf (staafpuntlast). */
export type OpenFem3DPointLoadTarget = { nodeId: number } | OpenFem3DBeamSpot;

/**
 * De puntlast van het gereedschap: −10 kN, omlaag. Dezelfde waarde als de
 * bestaande puntlastknop (het formulier van de staafpuntlast begint met
 * Pz = −10 kN) en de puntlast in 2D. Op een knoop in globale Z, op een staaf
 * in lokale z.
 */
export const OPEN_FEM_3D_DEFAULT_POINT_LOAD_KN = -10;

/** Binnen deze fractie van de lengte is een plek op een staaf het staafeinde (gelijk aan splitOpenFem3DBeam). */
const BEAM_END_RATIO = 1e-6;
/** Een vrij punt binnen deze afstand van een bestaande knoop is die knoop (m). */
const SAME_POINT_M = 1e-7;
/** Een plaatpunt binnen deze afstand van een bestaande knoop is die knoop (m). */
const SAME_PLATE_POINT_M = 1e-6;

function requireNodeId(model: OpenFem3DModel, nodeId: number): void {
  if (!model.nodes.some((node) => node.id === nodeId)) throw new Error(`3D-knoop ${nodeId} bestaat niet.`);
}

/** De staaf, zijn lengte en de fractie langs de staaf van een plek; een plek buiten de staaf is een fout. */
export function openFem3DBeamSpotRatio(
  model: OpenFem3DModel, spot: OpenFem3DBeamSpot,
): { ratio: number; positionM: number; lengthM: number } {
  const beam = model.beams.find((item) => item.id === spot.beamId);
  if (!beam) throw new Error(`3D-staaf ${spot.beamId} bestaat niet.`);
  const start = model.nodes.find((node) => node.id === beam.startNodeId);
  const end = model.nodes.find((node) => node.id === beam.endNodeId);
  if (!start || !end) throw new Error("De 3D-staaf verwijst naar een ontbrekende knoop.");
  const lengthM = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (!(lengthM > 1e-12)) throw new Error(`3D-staaf ${spot.beamId} heeft geen lengte.`);
  const given = "t" in spot ? spot.t * lengthM : spot.positionM;
  if (!Number.isFinite(given) || given < -1e-9 || given > lengthM + 1e-9) {
    throw new Error(`De plek moet binnen de staaflengte van 3D-staaf ${spot.beamId} liggen (0 … ${lengthM} m).`);
  }
  const positionM = Math.min(lengthM, Math.max(0, given));
  return { ratio: positionM / lengthM, positionM, lengthM };
}

/**
 * Een punt op het middenvlak van een plaat: loodrecht op het vlak
 * geprojecteerd, en de afhankelijke coördinaat (die met de grootste
 * normaalcomponent) exact uit de vlakvergelijking, zodat een horizontale
 * plaat de knoop precies op haar hoogte krijgt. `roundToMm` (het tekenvlak)
 * rondt de twee andere coördinaten eerst af op hele millimeters. `state`
 * zegt of het punt binnen de plaat, op een rand, in een opening of erbuiten
 * ligt, met de contour van het rekennet.
 */
export function projectOpenFem3DPointOnPlate(
  model: OpenFem3DModel, plateId: number, point: OpenFem3DPoint, options: { roundToMm?: boolean } = {},
): { point: OpenFem3DPoint; state: "inside" | "boundary" | "opening" | "outside" } {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error("Het punt op de plaat moet eindige coördinaten hebben.");
  const { origin, normal } = openFem3DPlatePlane(model, plate);
  const afstand = (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y + (point.z - origin.z) * normal.z;
  const projected: OpenFem3DPoint = {
    x: point.x - afstand * normal.x, y: point.y - afstand * normal.y, z: point.z - afstand * normal.z,
  };
  const axes = ["x", "y", "z"] as const;
  const dependent = axes.reduce((best, axis) => Math.abs(normal[axis]) > Math.abs(normal[best]) ? axis : best);
  const free = axes.filter((axis) => axis !== dependent);
  if (options.roundToMm) for (const axis of free) projected[axis] = Math.round(projected[axis] * 1000) / 1000;
  projected[dependent] = origin[dependent]
    - free.reduce((sum, axis) => sum + normal[axis] * (projected[axis] - origin[axis]), 0) / normal[dependent];
  for (const axis of axes) if (Object.is(projected[axis], -0)) projected[axis] = 0;
  return { point: projected, state: classifyOpenFem3DPlatePoint(model, plate, projected) };
}

/** Een knoop ligt in het middenvlak van een plaat als hij hoogstens de halve dikte plus deze marge (m) ervan af ligt. */
const PLATE_MIDPLANE_MARGIN_M = 1e-3;

/**
 * Waar een knoop bij hoort, voor het plaatsen met snap (issue #76): de staven
 * waarvan hij begin- of eindknoop is, en de platen (uit `plateIds`, standaard
 * alle) waarin hij ligt: in het middenvlak (binnen de halve dikte plus 1 mm)
 * en binnen of op de rand van de plaat, niet in een opening of ernaast. Zo'n
 * staaf of plaat kan de knoop op het scherm niet afdekken: hij zit in het
 * profiel of in de plaat (chooseOpenFem3DPlacement in openFem3dPick.ts).
 */
export function openFem3DPlacementNodeOwners(
  model: OpenFem3DModel, nodeId: number, plateIds?: Iterable<number>,
): { beamIds: number[]; plateIds: number[] } {
  const node = model.nodes.find((item) => item.id === nodeId);
  if (!node) return { beamIds: [], plateIds: [] };
  const beamIds = model.beams.filter((beam) => beam.startNodeId === nodeId || beam.endNodeId === nodeId).map((beam) => beam.id);
  const wanted = plateIds === undefined ? null : new Set(plateIds);
  const owners: number[] = [];
  for (const plate of model.plates ?? []) {
    if (wanted && !wanted.has(plate.id)) continue;
    if (plate.nodeIds.includes(nodeId)) { owners.push(plate.id); continue; }
    try {
      const { origin, normal } = openFem3DPlatePlane(model, plate);
      const afstand = (node.x - origin.x) * normal.x + (node.y - origin.y) * normal.y + (node.z - origin.z) * normal.z;
      if (Math.abs(afstand) > plate.thicknessM / 2 + PLATE_MIDPLANE_MARGIN_M) continue;
      const state = classifyOpenFem3DPlatePoint(model, plate, node);
      if (state === "inside" || state === "boundary") owners.push(plate.id);
    } catch {
      // Een plaat zonder geldig vlak (ontbrekende of samenvallende knopen) heeft geen middenvlak.
    }
  }
  return { beamIds, plateIds: owners };
}

/** De knoop waarop een oplegging of veer komt, en het model waarin hij (zo nodig) gemaakt is. */
export interface OpenFem3DPlacementNode {
  model: OpenFem3DModel;
  nodeId: number;
  /**
   * Hoe de knoop er kwam: "existing" (bestond al, model ongewijzigd), "point"
   * (nieuw op een vrij punt), "beamSplit" (de staaf is op die plek gesplitst)
   * of "plate" (nieuw in het middenvlak van een plaat).
   */
  created: "existing" | "point" | "beamSplit" | "plate";
  /** Bij "beamSplit": de gesplitste staaf (houdt zijn id, eerste deel) en het tweede deel. */
  split?: { beamId: number; secondBeamId: number };
}

function nextNodeId(model: OpenFem3DModel): number {
  return model.nodes.reduce((maximum, node) => Math.max(maximum, node.id), 0) + 1;
}

/** Zoek of maak de knoop van een plaatsingsdoel. Een ongeldig doel (onbekend, in een opening, buiten de plaat of staaf) is een fout. */
export function resolveOpenFem3DPlacementNode(model: OpenFem3DModel, target: OpenFem3DPlacementTarget): OpenFem3DPlacementNode {
  if ("nodeId" in target) {
    requireNodeId(model, target.nodeId);
    return { model, nodeId: target.nodeId, created: "existing" };
  }
  if ("position" in target) {
    const { x, y, z } = target.position;
    if (![x, y, z].every(Number.isFinite)) throw new Error("Het punt moet eindige coördinaten hebben.");
    const existing = model.nodes.find((node) => Math.hypot(node.x - x, node.y - y, node.z - z) < SAME_POINT_M);
    if (existing) return { model, nodeId: existing.id, created: "existing" };
    const nodeId = nextNodeId(model);
    return { model: { ...model, nodes: [...model.nodes, { id: nodeId, x, y, z }] }, nodeId, created: "point" };
  }
  if ("plateId" in target) {
    const plate = (model.plates ?? []).find((item) => item.id === target.plateId)!;
    const { point, state } = projectOpenFem3DPointOnPlate(model, target.plateId, target.point);
    if (state === "opening") throw new Error(`Het punt ligt in een opening van 3D-plaat ${target.plateId}.`);
    if (state === "outside") throw new Error(`Het punt ligt buiten 3D-plaat ${target.plateId}.`);
    const existing = model.nodes.find((node) =>
      Math.hypot(node.x - point.x, node.y - point.y, node.z - point.z) <= SAME_PLATE_POINT_M);
    if (existing) return { model, nodeId: existing.id, created: "existing" };
    const nodeId = nextNodeId(model);
    // Een plaat op een level houdt al haar knopen op dat level; de knoop in
    // het veld hoort daar ook bij, anders blijft hij achter als het level
    // verschuift.
    const node = { id: nodeId, ...point, ...(plate.levelId !== undefined ? { levelId: plate.levelId } : {}) };
    return { model: { ...model, nodes: [...model.nodes, node] }, nodeId, created: "plate" };
  }
  const { ratio } = openFem3DBeamSpotRatio(model, target);
  const beam = model.beams.find((item) => item.id === target.beamId)!;
  if (ratio <= BEAM_END_RATIO) return { model, nodeId: beam.startNodeId, created: "existing" };
  if (ratio >= 1 - BEAM_END_RATIO) return { model, nodeId: beam.endNodeId, created: "existing" };
  const split = splitOpenFem3DBeam(model, target.beamId, ratio);
  return {
    model: split.model, nodeId: split.nodeId, created: "beamSplit",
    split: { beamId: split.firstBeamId, secondBeamId: split.secondBeamId },
  };
}

/** Eigen waarden voor een puntlast; zonder waarden geldt de standaard (−10 kN omlaag). */
export type OpenFem3DPointLoadValues = Partial<OpenFem3DNodalLoadComponents> & { py?: number; pz?: number };

export interface OpenFem3DPlacedPointLoad {
  model: OpenFem3DModel;
  kind: "nodal" | "memberPoint";
  loadId: number;
  /** De nieuwe last, om in het eigenschappenpaneel te openen. */
  selection: Extract<OpenFem3DSingleSelection, { type: "nodalLoad" | "memberPointLoad" }>;
}

/**
 * Een puntlast in belastinggeval `caseId`: op een knoop een knooplast (Fz =
 * −10 kN), op een staaf een staafpuntlast op die plek (Pz = −10 kN, lokaal);
 * de staaf blijft heel. Eén nieuw model, dus één stap ongedaan maken.
 */
export function placeOpenFem3DPointLoad(
  model: OpenFem3DModel, target: OpenFem3DPointLoadTarget, caseId: number, values?: OpenFem3DPointLoadValues,
): OpenFem3DPlacedPointLoad {
  const given = values && Object.values(values).some((value) => value !== undefined);
  if ("nodeId" in target) {
    requireNodeId(model, target.nodeId);
    const components: OpenFem3DNodalLoadComponents = given
      ? { fx: values!.fx ?? 0, fy: values!.fy ?? 0, fz: values!.fz ?? 0, mx: values!.mx ?? 0, my: values!.my ?? 0, mz: values!.mz ?? 0 }
      : { fx: 0, fy: 0, fz: OPEN_FEM_3D_DEFAULT_POINT_LOAD_KN, mx: 0, my: 0, mz: 0 };
    const next = addOpenFem3DNodalLoad(model, target.nodeId, components, caseId);
    const loadId = next.loads![next.loads!.length - 1].id;
    return { model: next, kind: "nodal", loadId, selection: { type: "nodalLoad", id: loadId } };
  }
  const { positionM } = openFem3DBeamSpotRatio(model, target);
  const forces = given ? { py: values!.py ?? 0, pz: values!.pz ?? 0 } : { py: 0, pz: OPEN_FEM_3D_DEFAULT_POINT_LOAD_KN };
  const next = addOpenFem3DMemberPointLoad(model, target.beamId, { ...forces, positionM }, caseId);
  const loadId = next.memberPointLoads![next.memberPointLoads!.length - 1].id;
  return { model: next, kind: "memberPoint", loadId, selection: { type: "memberPointLoad", id: loadId } };
}
