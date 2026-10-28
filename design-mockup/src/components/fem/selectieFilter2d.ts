/**
 * Selectiefilter in 2D (issue #94): van het 2D-model en een selectie naar de
 * elementen van het gedeelde filter (`selectieFilter/selectieFilter.ts`), en
 * van wat overblijft terug naar een 2D-selectie.
 *
 * KENMERKEN IN 2D
 *  - knoop: oplegging;
 *  - staaf: profiel en materiaal (zonder: HEA160 en S235, zoals het
 *    eigenschappenpaneel en de tabel), staaftype (`rolVanStaaf`: ingesteld,
 *    anders afgeleid uit de geometrie), richting, lengte in mm;
 *  - plaat: materiaal (`materiaal`; zonder: "", want dan rekent de plaat met
 *    haar losse E, ν en ρ en heeft ze geen materiaalnaam);
 *  - last: belastinggeval en soort (puntlast op knoop, moment, lijnlast,
 *    puntlast op staaf, temperatuurlast, randlast, puntlast op plaatrand).
 * 2D kent geen levels en geen groepen.
 *
 * Zuiver: geen React, geen DOM.
 */
import { rolVanStaaf, type Beam, type Load, type Node, type Plate, type Selection, type Support } from "./femTypes";
import {
  filterElementen, filterRichting, filterTelling, type FilterCriterium, type FilterElement, type FilterLastSoort,
  type FilterTelling,
} from "../selectieFilter/selectieFilter";

/** Profiel en materiaal van een staaf zonder eigen keuze, zoals in het eigenschappenpaneel. */
const STANDAARD_PROFIEL = "HEA160";
const STANDAARD_MATERIAAL = "S235";

export interface Model2DVoorFilter {
  nodes: readonly Node[];
  beams: readonly Beam[];
  plates: readonly Plate[];
  supports: readonly Support[];
  loads: readonly Load[];
}

export interface SelectieIds2D {
  nodeIds: number[];
  beamIds: number[];
  plateIds: number[];
  loadIds: number[];
}

export interface FilterUitkomst2D {
  ids: SelectieIds2D;
  telling: FilterTelling;
  /** Er was niets geselecteerd: het filter werkte op het hele model. */
  heleModel: boolean;
}

/** De soort van een 2D-last in het filter. */
export function lastSoort2D(load: Pick<Load, "type" | "beamId" | "plateId">): FilterLastSoort {
  switch (load.type) {
    case "pointForce": return load.beamId !== undefined ? "memberPoint" : load.plateId !== undefined ? "edgePoint" : "nodal";
    case "pointMoment": return "moment";
    case "lineLoad": return "line";
    case "thermal": return "thermal";
    case "edgeLoad": return "edge";
  }
}

/** De id's van een 2D-selectie; `null` als er niets geselecteerd is (dan geldt het hele model). */
export function selectieIds2D(selection: Selection): SelectieIds2D | null {
  if (!selection) return null;
  const ids: SelectieIds2D = { nodeIds: [], beamIds: [], plateIds: [], loadIds: [] };
  if (selection.type === "multi") {
    ids.nodeIds = [...selection.nodeIds];
    ids.beamIds = [...selection.beamIds];
    ids.plateIds = [...selection.plateIds];
    ids.loadIds = [...(selection.loadIds ?? [])];
  } else if (selection.type === "node") ids.nodeIds = [selection.id];
  else if (selection.type === "beam") ids.beamIds = [selection.id];
  else if (selection.type === "plate") ids.plateIds = [selection.id];
  else ids.loadIds = [selection.id];
  const aantal = ids.nodeIds.length + ids.beamIds.length + ids.plateIds.length + ids.loadIds.length;
  return aantal === 0 ? null : ids;
}

/** De elementen van het filter: van de selectie, of van het hele model als `ids` null is. */
export function filterElementen2D(model: Model2DVoorFilter, ids: SelectieIds2D | null): FilterElement[] {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const supported = new Set(model.supports.map((support) => support.nodeId));
  const nodes = model.nodes as Node[];
  const kies = <T extends { id: number }>(items: readonly T[], gekozen: readonly number[] | undefined): readonly T[] => {
    if (!ids) return items;
    const set = new Set(gekozen ?? []);
    return items.filter((item) => set.has(item.id));
  };
  const elementen: FilterElement[] = [];
  for (const node of kies(model.nodes, ids?.nodeIds)) {
    elementen.push({ soort: "node", id: node.id, support: supported.has(node.id) });
  }
  for (const beam of kies(model.beams, ids?.beamIds)) {
    const a = nodeById.get(beam.from), b = nodeById.get(beam.to);
    const lengthMm = a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0;
    elementen.push({
      soort: "beam", id: beam.id,
      profile: beam.profile ?? STANDAARD_PROFIEL,
      material: beam.material ?? STANDAARD_MATERIAAL,
      role: rolVanStaaf(beam, nodes),
      ...(a && b && lengthMm > 0 ? { direction: filterRichting((b.z - a.z) / lengthMm) } : {}),
      lengthMm,
    });
  }
  for (const plate of kies(model.plates, ids?.plateIds)) {
    elementen.push({ soort: "plate", id: plate.id, material: plate.materiaal?.trim() ?? "" });
  }
  for (const load of kies(model.loads, ids?.loadIds)) {
    elementen.push({ soort: "load", id: load.id, loadCase: load.caseId, loadKind: lastSoort2D(load) });
  }
  return elementen;
}

/** Het selectiefilter in 2D: de selectie (of het hele model) gefilterd met de criteria. */
export function filterSelectie2D(
  model: Model2DVoorFilter,
  ids: SelectieIds2D | null,
  criteria: readonly FilterCriterium[],
): FilterUitkomst2D {
  const over = filterElementen(filterElementen2D(model, ids), criteria);
  const uit: SelectieIds2D = { nodeIds: [], beamIds: [], plateIds: [], loadIds: [] };
  for (const element of over) {
    if (element.soort === "node") uit.nodeIds.push(element.id);
    else if (element.soort === "beam") uit.beamIds.push(element.id);
    else if (element.soort === "plate") uit.plateIds.push(element.id);
    else uit.loadIds.push(element.id);
  }
  for (const lijst of [uit.nodeIds, uit.beamIds, uit.plateIds, uit.loadIds]) lijst.sort((a, b) => a - b);
  return { ids: uit, telling: filterTelling(over), heleModel: ids === null };
}

/**
 * De belastinggevallen van de lasten in `ids`, oplopend en zonder dubbele:
 * met `filterLastGeval` kiest de app na Toepassen welk geval ze toont.
 */
export function selectieBelastinggevallen2D(model: Pick<Model2DVoorFilter, "loads">, ids: Pick<SelectieIds2D, "loadIds">): number[] {
  const gekozen = new Set(ids.loadIds);
  const gevallen = new Set(model.loads.filter((load) => gekozen.has(load.id)).map((load) => load.caseId));
  return [...gevallen].sort((a, b) => a - b);
}

/**
 * Een 2D-selectie uit id's: niets → `null`, één element → een enkele
 * selectie, anders een groep. `loadIds` alleen als er lasten zijn: zonder dat
 * veld gedraagt elke andere groepsselectie zich als altijd.
 */
export function selectieUitIds2D(ids: SelectieIds2D): Selection {
  const { nodeIds, beamIds, plateIds, loadIds } = ids;
  const totaal = nodeIds.length + beamIds.length + plateIds.length + loadIds.length;
  if (totaal === 0) return null;
  if (totaal === 1) {
    if (nodeIds.length) return { type: "node", id: nodeIds[0] };
    if (beamIds.length) return { type: "beam", id: beamIds[0] };
    if (plateIds.length) return { type: "plate", id: plateIds[0] };
    return { type: "load", id: loadIds[0] };
  }
  return {
    type: "multi", nodeIds: [...nodeIds], beamIds: [...beamIds], plateIds: [...plateIds],
    ...(loadIds.length ? { loadIds: [...loadIds] } : {}),
  };
}
