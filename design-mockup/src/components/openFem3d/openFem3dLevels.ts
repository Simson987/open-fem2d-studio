import type { GridAxisLine, StructuralGrid } from "../fem/femTypes";
import { peilmaatTekst } from "../../lib/peilmaat";
import { parseOpenFem3DModel, type OpenFem3DModel, type OpenFem3DPlate } from "./openFem3dModel";

/**
 * Levels in de 3D-werkruimte.
 *
 * Een level is een horizontale stramienas (`StructuralGrid.zAxes`): een naam
 * en een hoogte in mm, bijvoorbeeld "Peil 0" = 0 en "1e verdieping" = 3000.
 * Het 3D-model rekent in meters, dus een knoop op een level heeft
 * z = hoogte / 1000.
 *
 * KOPPELING
 *  - `node.levelId`: de knoop ligt op de hoogte van het level en schuift mee
 *    als die hoogte verandert.
 *  - `plate.levelId`: de plaat ligt horizontaal op het level. Al haar knopen,
 *    ook die van de openingen, dragen dan hetzelfde `levelId`: een plaat
 *    koppelen koppelt haar knopen mee. Een plaat ontkoppelen maakt haar
 *    knopen weer vrij, behalve knopen die een andere gekoppelde plaat nog
 *    vasthoudt. Zo'n vastgehouden knoop los ontkoppelen of aan een ander
 *    level hangen wordt geweigerd: de plaat zou dan niet meer op haar level
 *    liggen.
 *  - Ontkoppelen laat een knoop staan waar hij staat.
 *
 * Alles hier is puur: model en levels erin, een nieuw model of een reden om
 * te weigeren eruit. De interface vertaalt die reden (openFem3d.levels.*).
 */

/** Wat de koppeling van een level nodig heeft; een `GridAxisLine` voldoet. */
export type OpenFem3DLevel = Pick<GridAxisLine, "id" | "label" | "position">;

export type OpenFem3DLevelRefusal =
  /** Het gekozen level bestaat niet (meer). */
  | { kind: "unknownLevel"; levelId: string }
  /** Een gekoppelde plaat die niet meedoet, houdt deze knoop op haar level. */
  | { kind: "heldByPlate"; nodeId: number; plateId: number; levelId: string }
  /** Begin- en eindknoop van een staaf zouden samenvallen. */
  | { kind: "zeroLengthBeam"; beamId: number }
  /** De modelpoort weigert het resultaat, bv. een plaat die niet meer vlak is. */
  | { kind: "invalidGeometry"; message: string };

export type OpenFem3DLevelResult =
  | { ok: true; model: OpenFem3DModel }
  | { ok: false; refusal: OpenFem3DLevelRefusal };

/** Een staaflast die binnen deze afstand van begin en eind ligt, loopt over de volle lengte. */
const FULL_LENGTH_TOLERANCE_M = 1e-6;

/** Hoogte van een level in meter (3D-model), uit de hoogte in mm (stramien). */
export function openFem3DLevelHeightM(level: Pick<GridAxisLine, "position">): number {
  return level.position / 1000;
}

/** Naam voor keuzelijsten en meldingen: de eigen naam, anders de peilmaat. */
export function openFem3DLevelName(level: Pick<GridAxisLine, "label" | "position">): string {
  return level.label.trim() || peilmaatTekst(level.position);
}

/** De levels van laag naar hoog; bij gelijke hoogte in de oorspronkelijke volgorde. */
export function openFem3DLevelsByHeight<T extends Pick<GridAxisLine, "position">>(levels: readonly T[]): T[] {
  return levels.map((level, index) => ({ level, index }))
    .sort((a, b) => a.level.position - b.level.position || a.index - b.index)
    .map(({ level }) => level);
}

/** Alle knopen van een plaat: buitenrand en openingen, elk één keer. */
export function openFem3DPlateNodeIds(plate: Pick<OpenFem3DPlate, "nodeIds" | "openings">): number[] {
  return [...new Set([...plate.nodeIds, ...(plate.openings ?? []).flatMap((opening) => opening.nodeIds)])];
}

/** De gekoppelde plaat die deze knoop op haar level houdt, of null. */
export function openFem3DPlateHoldingNode(model: OpenFem3DModel, nodeId: number): OpenFem3DPlate | null {
  return (model.plates ?? []).find((plate) =>
    plate.levelId !== undefined && openFem3DPlateNodeIds(plate).includes(nodeId)) ?? null;
}

function refuse(refusal: OpenFem3DLevelRefusal): OpenFem3DLevelResult {
  return { ok: false, refusal };
}

function withoutLevel<T extends { levelId?: string }>(item: T): T {
  if (item.levelId === undefined) return item;
  const { levelId: _levelId, ...rest } = item;
  return rest as T;
}

/** Zelfde array als er niets verandert: de 3D-weergave bouwt dan niets opnieuw. */
function mapChanged<T>(items: readonly T[], change: (item: T) => T): T[] {
  let result: T[] | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const next = change(items[index]);
    if (next !== items[index]) {
      result ??= items.slice();
      result[index] = next;
    }
  }
  return result ?? (items as T[]);
}

function beamLengthM(nodes: ReadonlyMap<number, { x: number; y: number; z: number }>, startNodeId: number, endNodeId: number): number {
  const start = nodes.get(startNodeId), end = nodes.get(endNodeId);
  return start && end ? Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) : Number.NaN;
}

/**
 * Een staaflast over de VOLLE lengte blijft dat als de staaf langer of korter
 * wordt (een kolom tussen twee levels); andere lasten houden hun afstand tot
 * het begin. Zonder deze stap dekte een windlast op een kolom na het verhogen
 * van een level stil niet meer de hele kolom.
 */
function withFullLengthMemberLoads(before: OpenFem3DModel, after: OpenFem3DModel): OpenFem3DModel {
  if (!after.memberLoads?.length) return after;
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const lengths = new Map<number, { from: number; to: number }>();
  for (const beam of after.beams) {
    const from = beamLengthM(beforeNodes, beam.startNodeId, beam.endNodeId);
    const to = beamLengthM(afterNodes, beam.startNodeId, beam.endNodeId);
    if (Number.isFinite(from) && Number.isFinite(to) && from !== to) lengths.set(beam.id, { from, to });
  }
  if (lengths.size === 0) return after;
  const memberLoads = mapChanged(after.memberLoads, (load) => {
    const length = lengths.get(load.beamId);
    if (!length) return load;
    const fullLength = Math.abs(load.startPositionM) <= FULL_LENGTH_TOLERANCE_M
      && Math.abs(load.endPositionM - length.from) <= FULL_LENGTH_TOLERANCE_M;
    return fullLength ? { ...load, endPositionM: length.to } : load;
  });
  return memberLoads === after.memberLoads ? after : { ...after, memberLoads };
}

function parseMessage(model: OpenFem3DModel): string | null {
  try {
    parseOpenFem3DModel(model);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Controleer een model waarin knopen van hoogte veranderd zijn: geen staaf
 * zonder lengte en een model dat de modelpoort accepteert (vlakke platen,
 * openingen binnen de plaat, lasten binnen de staaf). Een fout die er vóór de
 * wijziging al was, is niet deze wijziging aan te rekenen en blokkeert niet.
 */
function finishGeometry(before: OpenFem3DModel, after: OpenFem3DModel): OpenFem3DLevelResult {
  const adapted = withFullLengthMemberLoads(before, after);
  const nodeById = new Map(adapted.nodes.map((node) => [node.id, node]));
  for (const beam of adapted.beams) {
    const start = nodeById.get(beam.startNodeId), end = nodeById.get(beam.endNodeId);
    if (start && end && start.x === end.x && start.y === end.y && start.z === end.z) {
      return refuse({ kind: "zeroLengthBeam", beamId: beam.id });
    }
  }
  const message = parseMessage(adapted);
  if (message !== null && message !== parseMessage(before)) return refuse({ kind: "invalidGeometry", message });
  return { ok: true, model: adapted };
}

/**
 * Koppel knopen en platen aan een level (`levelId`), of ontkoppel ze (`null`).
 *
 * Koppelen zet elke betrokken knoop op de hoogte van het level; bij een plaat
 * zijn dat al haar knopen. Ontkoppelen verplaatst niets. Eén aanroep is één
 * modelwijziging, dus één stap ongedaan maken, ook bij een meervoudige selectie.
 */
export function linkOpenFem3DToLevel(
  model: OpenFem3DModel,
  target: { nodeIds?: readonly number[]; plateIds?: readonly number[] },
  levelId: string | null,
  levels: readonly OpenFem3DLevel[],
): OpenFem3DLevelResult {
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  const plates = model.plates ?? [];
  const plateById = new Map(plates.map((plate) => [plate.id, plate]));
  for (const id of target.nodeIds ?? []) if (!nodeIds.has(id)) throw new Error(`3D-knoop ${id} bestaat niet.`);
  for (const id of target.plateIds ?? []) if (!plateById.has(id)) throw new Error(`3D-plaat ${id} bestaat niet.`);

  const targetPlates = new Set(target.plateIds ?? []);
  const explicitNodes = new Set(target.nodeIds ?? []);
  const plateNodes = new Set([...targetPlates].flatMap((id) => openFem3DPlateNodeIds(plateById.get(id)!)));
  // Gekoppelde platen die NIET meedoen, houden hun knopen op hun level.
  const holders = new Map<number, OpenFem3DPlate>();
  for (const plate of plates) {
    if (plate.levelId === undefined || targetPlates.has(plate.id)) continue;
    for (const nodeId of openFem3DPlateNodeIds(plate)) if (!holders.has(nodeId)) holders.set(nodeId, plate);
  }
  const withPlates = (nodes: OpenFem3DModel["nodes"], nextPlates: OpenFem3DPlate[]): OpenFem3DModel => ({
    ...model, nodes, ...(model.plates ? { plates: nextPlates } : {}),
  });

  if (levelId === null) {
    for (const nodeId of explicitNodes) {
      const holder = holders.get(nodeId);
      if (holder) return refuse({ kind: "heldByPlate", nodeId, plateId: holder.id, levelId: holder.levelId! });
    }
    const released = new Set([...explicitNodes, ...[...plateNodes].filter((id) => !holders.has(id))]);
    const nodes = mapChanged(model.nodes, (node) => released.has(node.id) ? withoutLevel(node) : node);
    const nextPlates = mapChanged(plates, (plate) => targetPlates.has(plate.id) ? withoutLevel(plate) : plate);
    if (nodes === model.nodes && nextPlates === plates) return { ok: true, model };
    return { ok: true, model: withPlates(nodes, nextPlates) };
  }

  const level = levels.find((item) => item.id === levelId);
  if (!level) return refuse({ kind: "unknownLevel", levelId });
  const z = openFem3DLevelHeightM(level);
  const linked = new Set([...explicitNodes, ...plateNodes]);
  for (const nodeId of linked) {
    const holder = holders.get(nodeId);
    if (holder && holder.levelId !== levelId) {
      return refuse({ kind: "heldByPlate", nodeId, plateId: holder.id, levelId: holder.levelId! });
    }
  }
  const nodes = mapChanged(model.nodes, (node) => linked.has(node.id) && (node.z !== z || node.levelId !== levelId)
    ? { ...node, z, levelId } : node);
  const nextPlates = mapChanged(plates, (plate) => targetPlates.has(plate.id) && plate.levelId !== levelId
    ? { ...plate, levelId } : plate);
  if (nodes === model.nodes && nextPlates === plates) return { ok: true, model };
  return finishGeometry(model, withPlates(nodes, nextPlates));
}

/**
 * Breng elke gekoppelde knoop op de hoogte van zijn level, na een wijziging
 * van de levels (hoogte aangepast, level verwijderd). Een level dat niet meer
 * bestaat laat zijn knopen en platen los; die blijven staan waar ze staan.
 */
export function applyOpenFem3DLevels(model: OpenFem3DModel, levels: readonly OpenFem3DLevel[]): OpenFem3DLevelResult {
  const byId = new Map(levels.map((level) => [level.id, level]));
  const nodes = mapChanged(model.nodes, (node) => {
    if (node.levelId === undefined) return node;
    const level = byId.get(node.levelId);
    if (!level) return withoutLevel(node);
    const z = openFem3DLevelHeightM(level);
    return node.z === z ? node : { ...node, z };
  });
  const plates = model.plates && mapChanged(model.plates, (plate) =>
    plate.levelId !== undefined && !byId.has(plate.levelId) ? withoutLevel(plate) : plate);
  if (nodes === model.nodes && plates === model.plates) return { ok: true, model };
  const next: OpenFem3DModel = { ...model, nodes, ...(plates ? { plates } : {}) };
  // mapChanged houdt de volgorde aan, dus index voor index vergelijken volstaat.
  const moved = nodes.some((node, index) => node.z !== model.nodes[index].z);
  return moved ? finishGeometry(model, next) : { ok: true, model: next };
}

/**
 * Laat koppelingen vallen naar levels die er niet (meer) zijn, zonder iets te
 * verplaatsen. Voor het openen van een project: de opgeslagen geometrie is
 * gezaghebbend.
 */
export function withoutUnknownOpenFem3DLevelLinks(model: OpenFem3DModel, levels: readonly OpenFem3DLevel[]): OpenFem3DModel {
  const known = new Set(levels.map((level) => level.id));
  const nodes = mapChanged(model.nodes, (node) =>
    node.levelId !== undefined && !known.has(node.levelId) ? withoutLevel(node) : node);
  const plates = model.plates && mapChanged(model.plates, (plate) =>
    plate.levelId !== undefined && !known.has(plate.levelId) ? withoutLevel(plate) : plate);
  return nodes === model.nodes && plates === model.plates ? model : { ...model, nodes, ...(plates ? { plates } : {}) };
}

/**
 * Een plaat blijft alleen op haar level als al haar knopen dat ook doen. Na
 * een bewerking die knopen van hoogte verandert (verplaatsen, roteren,
 * spiegelen) valt de koppeling van zo'n plaat daarom weg.
 */
export function withConsistentOpenFem3DPlateLevels(model: OpenFem3DModel): OpenFem3DModel {
  if (!model.plates?.some((plate) => plate.levelId !== undefined)) return model;
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const plates = mapChanged(model.plates, (plate) => plate.levelId === undefined
    || openFem3DPlateNodeIds(plate).every((id) => nodeById.get(id)?.levelId === plate.levelId)
    ? plate : withoutLevel(plate));
  return plates === model.plates ? model : { ...model, plates };
}

/**
 * Controle voor invoer van buiten (bedieningskanaal/MCP): bestaat elk level,
 * ligt elke gekoppelde knoop op de hoogte van zijn level, en liggen alle
 * knopen van een gekoppelde plaat op hetzelfde level? Geeft de eerste fout
 * als Nederlandse tekst, of null.
 */
export function openFem3DLevelLinkError(
  model: OpenFem3DModel, levels: readonly OpenFem3DLevel[], toleranceM = 1e-6,
): string | null {
  const byId = new Map(levels.map((level) => [level.id, level]));
  for (const node of model.nodes) {
    if (node.levelId === undefined) continue;
    const level = byId.get(node.levelId);
    if (!level) return `3D-knoop ${node.id}: level ${node.levelId} bestaat niet.`;
    const height = openFem3DLevelHeightM(level);
    if (Math.abs(node.z - height) > toleranceM) {
      return `3D-knoop ${node.id}: z = ${node.z} m wijkt af van de hoogte van level "${openFem3DLevelName(level)}" (${height} m).`;
    }
  }
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  for (const plate of model.plates ?? []) {
    if (plate.levelId === undefined) continue;
    if (!byId.has(plate.levelId)) return `3D-plaat ${plate.id}: level ${plate.levelId} bestaat niet.`;
    const loose = openFem3DPlateNodeIds(plate).find((id) => nodeById.get(id)?.levelId !== plate.levelId);
    if (loose !== undefined) {
      return `3D-plaat ${plate.id} ligt op level "${openFem3DLevelName(byId.get(plate.levelId)!)}", ` +
        `maar knoop ${loose} hangt niet aan dat level.`;
    }
  }
  return null;
}

/**
 * Levels uit invoer van buiten (bedieningskanaal/MCP): een label en een hoogte
 * in METER. Een level waarvan het label al bestaat, houdt zijn id, zodat de
 * knopen en platen die eraan hangen gekoppeld blijven en meeschuiven. Een
 * nieuw level krijgt een id dat nog niet in gebruik is, ook niet door een
 * level dat vervalt: anders zou een knoop stil een ander level volgen.
 */
export function openFem3DLevelsFromMetres(
  input: unknown, current: readonly OpenFem3DLevel[], key = "levels",
): OpenFem3DLevel[] {
  return openFem3DGridAxesFromMetres(input, current, "z", key);
}

/**
 * Stramienassen uit invoer van buiten, zoals de levels hierboven: een label en
 * een positie in METER; een as met een bestaand label houdt zijn id, een
 * nieuwe as krijgt `<voorvoegsel>-n` met een n die nog niet in gebruik is.
 * Voor de assen in X en Y (`x`, `y`) en de levels (`z`).
 */
export function openFem3DGridAxesFromMetres(
  input: unknown, current: readonly OpenFem3DLevel[], voorvoegsel: string, key: string,
): OpenFem3DLevel[] {
  if (!Array.isArray(input)) throw new Error(`${key} moet een lijst zijn`);
  const items = input.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${key}[${index}] is ongeldig`);
    const item = raw as Record<string, unknown>;
    if (typeof item.label !== "string" || typeof item.position_m !== "number" || !Number.isFinite(item.position_m)) {
      throw new Error(`${key}[${index}] vereist label en position_m`);
    }
    // Afronden op 10⁻⁶ mm: 1,1 m wordt 1100 mm en niet 1100,0000000000002.
    return { label: item.label, position: Math.round(item.position_m * 1e9) / 1e6 };
  });
  const reused = new Set<string>();
  const ids = items.map((item) => {
    const existing = current.find((level) => level.label === item.label && !reused.has(level.id));
    if (existing) reused.add(existing.id);
    return existing?.id;
  });
  const taken = new Set([...current.map((level) => level.id), ...reused]);
  let counter = 1;
  return items.map((item, index) => {
    let id = ids[index];
    if (id === undefined) {
      while (taken.has(`${voorvoegsel}-${counter}`)) counter += 1;
      id = `${voorvoegsel}-${counter}`;
      taken.add(id);
    }
    return { id, label: item.label, position: item.position };
  });
}

/** De i18n-sleutel (naamruimte ribbon) en waarden van een weigering. */
export function openFem3DLevelRefusalText(
  refusal: OpenFem3DLevelRefusal, levels: readonly OpenFem3DLevel[],
): { key: string; values: Record<string, string | number> } {
  const name = (levelId: string) => {
    const level = levels.find((item) => item.id === levelId);
    return level ? openFem3DLevelName(level) : levelId;
  };
  switch (refusal.kind) {
    case "unknownLevel":
      return { key: "openFem3d.levels.refused.unknownLevel", values: { level: name(refusal.levelId) } };
    case "heldByPlate":
      return {
        key: "openFem3d.levels.refused.heldByPlate",
        values: { node: refusal.nodeId, plate: refusal.plateId, level: name(refusal.levelId) },
      };
    case "zeroLengthBeam":
      return { key: "openFem3d.levels.refused.zeroLengthBeam", values: { beam: refusal.beamId } };
    case "invalidGeometry":
      return { key: "openFem3d.levels.refused.invalidGeometry", values: { detail: refusal.message } };
  }
}

// ── Ongedaan maken ─────────────────────────────────────────────────────────

/** Eén level zoals het vóór of ná een stap stond, met zijn plaats in de lijst. */
export interface OpenFem3DLevelPatchEntry {
  level: OpenFem3DLevel;
  index: number;
}

/** Per level-id de stand die terug moet komen; null = dat level hoort er niet. */
export type OpenFem3DLevelPatch = Readonly<Record<string, OpenFem3DLevelPatchEntry | null>>;

/**
 * Wat een stap met de levels deed: `before` zet undo terug, `after` zet redo
 * opnieuw. Alleen hoogtes, toegevoegde en verwijderde levels tellen; een
 * nieuwe naam is geen stap (zoals andere stramienbewerkingen) en wordt bij
 * ongedaan maken ook niet teruggedraaid.
 */
export interface OpenFem3DLevelTransition {
  before: OpenFem3DLevelPatch;
  after: OpenFem3DLevelPatch;
}

const copyLevel = (level: OpenFem3DLevel): OpenFem3DLevel => ({ id: level.id, label: level.label, position: level.position });

export function openFem3DLevelTransition(
  before: readonly OpenFem3DLevel[], after: readonly OpenFem3DLevel[],
): OpenFem3DLevelTransition | null {
  const beforePatch: Record<string, OpenFem3DLevelPatchEntry | null> = {};
  const afterPatch: Record<string, OpenFem3DLevelPatchEntry | null> = {};
  const afterIndex = new Map(after.map((level, index) => [level.id, index]));
  const beforeIds = new Set(before.map((level) => level.id));
  before.forEach((level, index) => {
    const next = afterIndex.get(level.id);
    if (next === undefined) {
      beforePatch[level.id] = { level: copyLevel(level), index };
      afterPatch[level.id] = null;
    } else if (after[next].position !== level.position) {
      beforePatch[level.id] = { level: copyLevel(level), index };
      afterPatch[level.id] = { level: copyLevel(after[next]), index: next };
    }
  });
  after.forEach((level, index) => {
    if (beforeIds.has(level.id)) return;
    beforePatch[level.id] = null;
    afterPatch[level.id] = { level: copyLevel(level), index };
  });
  return Object.keys(beforePatch).length > 0 ? { before: beforePatch, after: afterPatch } : null;
}

/**
 * Pas een levelstand toe op het stramien: hoogtes terugzetten, verwijderde
 * levels op hun oude plaats terugzetten en toegevoegde weghalen. De naam van
 * een bestaand level blijft zoals hij nu is.
 */
export function withOpenFem3DLevelPatch(grid: StructuralGrid, patch: OpenFem3DLevelPatch): StructuralGrid {
  const entries = Object.entries(patch);
  let zAxes = grid.zAxes.filter((axis) => patch[axis.id] !== null);
  if (zAxes.length === grid.zAxes.length) zAxes = grid.zAxes;
  zAxes = mapChanged(zAxes, (axis) => {
    const entry = patch[axis.id];
    return entry && entry.level.position !== axis.position ? { ...axis, position: entry.level.position } : axis;
  });
  const present = new Set(zAxes.map((axis) => axis.id));
  const inserts = entries
    .filter((entry): entry is [string, OpenFem3DLevelPatchEntry] => entry[1] !== null && !present.has(entry[0]))
    .sort((a, b) => a[1].index - b[1].index);
  if (inserts.length > 0) {
    zAxes = zAxes.slice();
    for (const [, entry] of inserts) zAxes.splice(Math.min(entry.index, zAxes.length), 0, copyLevel(entry.level));
  }
  return zAxes === grid.zAxes ? grid : { ...grid, zAxes };
}
