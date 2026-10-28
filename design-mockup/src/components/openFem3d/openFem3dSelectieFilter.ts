/**
 * Selectiefilter in 3D (issue #94): van het 3D-model en een selectie naar de
 * elementen van het filter (`selectieFilter.ts`), en van wat overblijft terug
 * naar id's per soort. Het venster Selectiefilter en het commando
 * `model3d.selection.filter` gebruiken allebei {@link filterOpenFem3D}.
 *
 * KENMERKEN IN 3D
 *  - knoop: oplegging (een regel in `supports`), levels;
 *  - staaf: profiel, materiaal, groep (`group`), richting, lengte in mm,
 *    levels (de levels van allebei de eindknopen);
 *  - plaat: materiaal, levels (haar `levelId`, en de levels van al haar
 *    hoekknopen);
 *  - last: belastinggeval en soort.
 * Een knoop ligt op een level als hij eraan gekoppeld is (`levelId`), of op
 * de hoogte ervan ligt (binnen 0,5 mm, de marge van peil 0 in
 * openFem3dWorkPlane). Een kolom tussen twee levels ligt op geen van beide.
 *
 * Zuiver: geen React, geen DOM.
 */
import type { GridAxisLine } from "../fem/femTypes";
import { openFem3DLoadCaseId, type OpenFem3DModel } from "./openFem3dModel";
import {
  OPEN_FEM_3D_LOAD_SELECTION_TYPES, type OpenFem3DLoadIds, type OpenFem3DLoadSelectionType, type OpenFem3DSelection,
} from "./openFem3dSelection";
import {
  filterElementen, filterRichting, filterTelling, type FilterCriterium, type FilterElement, type FilterLastSoort,
  type FilterTelling,
} from "../selectieFilter/selectieFilter";

/** Wat het filter van een level nodig heeft; een `GridAxisLine` voldoet. */
export type OpenFem3DFilterLevel = Pick<GridAxisLine, "id" | "position">;

/** Id's per soort: de basis van het filter en wat ervan overblijft. */
export interface OpenFem3DSelectieIds {
  nodeIds: number[];
  beamIds: number[];
  plateIds: number[];
  loads: OpenFem3DLoadIds;
}

export interface OpenFem3DFilterUitkomst {
  ids: OpenFem3DSelectieIds;
  telling: FilterTelling;
  /** Er was niets geselecteerd: het filter werkte op het hele model. */
  heleModel: boolean;
}

/** De lastsoort van het filter per selectiesoort, en terug. */
export const OPEN_FEM_3D_FILTER_LAST_SOORT: Record<OpenFem3DLoadSelectionType, FilterLastSoort> = {
  nodalLoad: "nodal",
  memberLoad: "line",
  memberPointLoad: "memberPoint",
  thermalLoad: "thermal",
  surfaceLoad: "surface",
  loadPanel: "loadPanel",
};
const SELECTIE_SOORT = Object.fromEntries(
  Object.entries(OPEN_FEM_3D_FILTER_LAST_SOORT).map(([type, soort]) => [soort, type]),
) as Partial<Record<FilterLastSoort, OpenFem3DLoadSelectionType>>;

/** Zo dicht bij de hoogte van een level ligt een knoop erop (mm). */
const LEVEL_MARGE_MM = 0.5;

/** De lasten van het model per selectiesoort. */
function lastenVan(model: OpenFem3DModel): Record<OpenFem3DLoadSelectionType, readonly { id: number; caseId?: number }[]> {
  return {
    nodalLoad: model.loads ?? [],
    memberLoad: model.memberLoads ?? [],
    memberPointLoad: model.memberPointLoads ?? [],
    thermalLoad: model.thermalLoads ?? [],
    surfaceLoad: model.surfaceLoads ?? [],
    loadPanel: model.loadPanels ?? [],
  };
}

/** De id's van een selectie; `null` als er niets geselecteerd is (dan geldt het hele model). */
export function openFem3DSelectieIds(selection: OpenFem3DSelection): OpenFem3DSelectieIds | null {
  if (!selection) return null;
  const ids: OpenFem3DSelectieIds = { nodeIds: [], beamIds: [], plateIds: [], loads: {} };
  if (selection.type === "multi") {
    ids.nodeIds = [...selection.nodeIds];
    ids.beamIds = [...selection.beamIds];
    ids.plateIds = [...(selection.plateIds ?? [])];
    for (const type of OPEN_FEM_3D_LOAD_SELECTION_TYPES) {
      if (selection.loads?.[type]?.length) ids.loads[type] = [...selection.loads[type]!];
    }
  } else if (selection.type === "node") ids.nodeIds = [selection.id];
  else if (selection.type === "beam") ids.beamIds = [selection.id];
  else if (selection.type === "plate") ids.plateIds = [selection.id];
  else if (selection.type !== "envelopePanel") ids.loads[selection.type] = [selection.id];
  const leeg = ids.nodeIds.length + ids.beamIds.length + ids.plateIds.length
    + OPEN_FEM_3D_LOAD_SELECTION_TYPES.reduce((n, type) => n + (ids.loads[type]?.length ?? 0), 0) === 0;
  return leeg ? null : ids;
}

/**
 * De elementen van het filter: van de selectie (`ids`), of van het hele model
 * als `ids` null is. Een id die niet (meer) in het model staat, valt weg.
 */
export function openFem3DFilterElementen(
  model: OpenFem3DModel,
  levels: readonly OpenFem3DFilterLevel[],
  ids: OpenFem3DSelectieIds | null,
): FilterElement[] {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const supported = new Set((model.supports ?? []).map((support) => support.nodeId));
  const nodeLevels = new Map<number, string[]>();
  const levelsOfNode = (nodeId: number): string[] => {
    let result = nodeLevels.get(nodeId);
    if (result) return result;
    const node = nodeById.get(nodeId);
    result = node ? levels.filter((level) => node.levelId === level.id
      || Math.abs(node.z * 1000 - level.position) <= LEVEL_MARGE_MM).map((level) => level.id) : [];
    nodeLevels.set(nodeId, result);
    return result;
  };
  /** De levels die alle knopen gemeen hebben. */
  const common = (nodeIds: readonly number[]) => {
    if (nodeIds.length === 0) return [];
    return nodeIds.slice(1).reduce((acc, nodeId) => acc.filter((level) => levelsOfNode(nodeId).includes(level)),
      levelsOfNode(nodeIds[0]));
  };
  const kies = <T extends { id: number }>(items: readonly T[], gekozen: readonly number[] | undefined): readonly T[] => {
    if (!ids) return items;
    const set = new Set(gekozen ?? []);
    return items.filter((item) => set.has(item.id));
  };

  const elementen: FilterElement[] = [];
  for (const node of kies(model.nodes, ids?.nodeIds)) {
    elementen.push({ soort: "node", id: node.id, support: supported.has(node.id), levels: levelsOfNode(node.id) });
  }
  for (const beam of kies(model.beams, ids?.beamIds)) {
    const start = nodeById.get(beam.startNodeId), end = nodeById.get(beam.endNodeId);
    const lengthM = start && end ? Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) : 0;
    elementen.push({
      soort: "beam", id: beam.id,
      profile: beam.profileName?.trim() ?? "",
      material: beam.material?.trim() ?? "",
      group: beam.group?.trim() ?? "",
      ...(start && end && lengthM > 0 ? { direction: filterRichting((end.z - start.z) / lengthM) } : {}),
      lengthMm: lengthM * 1000,
      levels: common([beam.startNodeId, beam.endNodeId]),
    });
  }
  for (const plate of kies(model.plates ?? [], ids?.plateIds)) {
    const levelsOfPlate = new Set(common(plate.nodeIds));
    if (plate.levelId !== undefined) levelsOfPlate.add(plate.levelId);
    elementen.push({
      soort: "plate", id: plate.id, material: plate.material?.trim() ?? "",
      levels: levels.map((level) => level.id).filter((id) => levelsOfPlate.has(id)),
    });
  }
  const lasten = lastenVan(model);
  for (const type of OPEN_FEM_3D_LOAD_SELECTION_TYPES) {
    for (const load of kies(lasten[type], ids?.loads[type])) {
      elementen.push({
        soort: "load", id: load.id, loadKind: OPEN_FEM_3D_FILTER_LAST_SOORT[type], loadCase: openFem3DLoadCaseId(load),
      });
    }
  }
  return elementen;
}

/** Elementen terug naar id's per soort, oplopend. */
export function openFem3DIdsVanElementen(elementen: readonly FilterElement[]): OpenFem3DSelectieIds {
  const ids: OpenFem3DSelectieIds = { nodeIds: [], beamIds: [], plateIds: [], loads: {} };
  for (const element of elementen) {
    if (element.soort === "node") ids.nodeIds.push(element.id);
    else if (element.soort === "beam") ids.beamIds.push(element.id);
    else if (element.soort === "plate") ids.plateIds.push(element.id);
    else {
      const type = element.loadKind && SELECTIE_SOORT[element.loadKind];
      if (type) (ids.loads[type] ??= []).push(element.id);
    }
  }
  const oplopend = (lijst: number[]) => lijst.sort((a, b) => a - b);
  oplopend(ids.nodeIds); oplopend(ids.beamIds); oplopend(ids.plateIds);
  Object.values(ids.loads).forEach((lijst) => oplopend(lijst!));
  return ids;
}

/**
 * Het selectiefilter in 3D: de selectie (of zonder selectie het hele model),
 * gefilterd met de criteria. Geeft de id's per soort, de telling per type en
 * of het hele model de basis was.
 */
export function filterOpenFem3D(
  model: OpenFem3DModel,
  levels: readonly OpenFem3DFilterLevel[],
  ids: OpenFem3DSelectieIds | null,
  criteria: readonly FilterCriterium[],
): OpenFem3DFilterUitkomst {
  const over = filterElementen(openFem3DFilterElementen(model, levels, ids), criteria);
  return { ids: openFem3DIdsVanElementen(over), telling: filterTelling(over), heleModel: ids === null };
}

/**
 * De belastinggevallen van de lasten in `ids`, oplopend. De app zet het
 * actieve geval op dat ene geval als alle gekozen lasten erin liggen: anders
 * staan ze geselecteerd maar niet in beeld.
 */
export function openFem3DSelectieBelastinggevallen(model: OpenFem3DModel, ids: OpenFem3DSelectieIds): number[] {
  const lasten = lastenVan(model);
  const gevallen = new Set<number>();
  for (const type of OPEN_FEM_3D_LOAD_SELECTION_TYPES) {
    const gekozen = new Set(ids.loads[type] ?? []);
    for (const load of lasten[type]) if (gekozen.has(load.id)) gevallen.add(openFem3DLoadCaseId(load));
  }
  return [...gevallen].sort((a, b) => a - b);
}
