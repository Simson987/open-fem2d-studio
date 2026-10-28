export type OpenFem3DSelectionType =
  | "node" | "beam"
  | "plate" | "envelopePanel" | "nodalLoad" | "memberLoad" | "memberPointLoad" | "thermalLoad" | "surfaceLoad" | "loadPanel";
export type OpenFem3DSingleSelection = {
  [Type in OpenFem3DSelectionType]: { type: Type; id: number }
}[OpenFem3DSelectionType];

/** De lastsoorten die een selectie kent; elke soort heeft zijn eigen nummering. */
export type OpenFem3DLoadSelectionType = Exclude<OpenFem3DSelectionType, "node" | "beam" | "plate" | "envelopePanel">;
export const OPEN_FEM_3D_LOAD_SELECTION_TYPES: readonly OpenFem3DLoadSelectionType[] = [
  "nodalLoad", "memberLoad", "memberPointLoad", "thermalLoad", "surfaceLoad", "loadPanel",
];
/**
 * Lasten in een groepsselectie, per soort. Optioneel en meestal afwezig: het
 * selectiefilter (issue #94) vult het, zoals in 2D `loadIds` alleen door
 * "selecteer alle lasten van deze soort" gevuld wordt. Klikken, het kader en
 * de verkenner laten het staan of vullen het niet.
 */
export type OpenFem3DLoadIds = Partial<Record<OpenFem3DLoadSelectionType, number[]>>;
export type OpenFem3DMultiSelection = {
  type: "multi"; nodeIds: number[]; beamIds: number[]; plateIds?: number[]; loads?: OpenFem3DLoadIds;
};
export type OpenFem3DSelection = OpenFem3DSingleSelection | OpenFem3DMultiSelection | null;

const isLoadType = (type: OpenFem3DSelectionType): type is OpenFem3DLoadSelectionType =>
  type !== "node" && type !== "beam" && type !== "plate" && type !== "envelopePanel";

/** Aantal lasten in een groepsselectie. */
export function openFem3DSelectionLoadCount(selection: OpenFem3DMultiSelection): number {
  return OPEN_FEM_3D_LOAD_SELECTION_TYPES.reduce((count, type) => count + (selection.loads?.[type]?.length ?? 0), 0);
}

/**
 * Aantal knopen, staven en platen in een groepsselectie, zonder de lasten:
 * wat het transformatiepaneel verplaatst, roteert, kopieert of spiegelt.
 */
export function openFem3DSelectionGeometryCount(selection: OpenFem3DMultiSelection): number {
  return selection.nodeIds.length + selection.beamIds.length + (selection.plateIds?.length ?? 0);
}

export function openFem3DSelectionContains(
  selection: OpenFem3DSelection,
  type: OpenFem3DSelectionType,
  id: number,
): boolean {
  if (!selection) return false;
  if (selection.type === type) return selection.id === id;
  if (selection.type !== "multi") return false;
  if (type === "node") return selection.nodeIds.includes(id);
  if (type === "beam") return selection.beamIds.includes(id);
  if (type === "plate") return (selection.plateIds ?? []).includes(id);
  if (type === "envelopePanel") return false;
  return (selection.loads?.[type] ?? []).includes(id);
}

export function openFem3DSelectionCount(selection: OpenFem3DSelection): number {
  if (!selection) return 0;
  return selection.type === "multi"
    ? selection.nodeIds.length + selection.beamIds.length + (selection.plateIds?.length ?? 0) + openFem3DSelectionLoadCount(selection)
    : 1;
}

/**
 * De selectie uit id's per soort: niets → `null`, precies één element → een
 * enkele selectie van die soort, anders een groep (gesorteerd, zonder
 * dubbele; `plateIds` en `loads` alleen als ze er zijn).
 */
export function openFem3DSelectionFromIds(ids: {
  nodeIds?: readonly number[]; beamIds?: readonly number[]; plateIds?: readonly number[]; loads?: OpenFem3DLoadIds;
}): OpenFem3DSelection {
  const sorted = (values: readonly number[] = []) => [...new Set(values)].sort((a, b) => a - b);
  const nodeIds = sorted(ids.nodeIds);
  const beamIds = sorted(ids.beamIds);
  const plateIds = sorted(ids.plateIds);
  const loads: OpenFem3DLoadIds = {};
  for (const type of OPEN_FEM_3D_LOAD_SELECTION_TYPES) {
    const loadIds = sorted(ids.loads?.[type]);
    if (loadIds.length) loads[type] = loadIds;
  }
  const loadEntries = Object.entries(loads) as [OpenFem3DLoadSelectionType, number[]][];
  const loadCount = loadEntries.reduce((count, [, loadIds]) => count + loadIds.length, 0);
  const total = nodeIds.length + beamIds.length + plateIds.length + loadCount;
  if (total === 0) return null;
  if (total === 1) {
    if (nodeIds.length) return { type: "node", id: nodeIds[0] };
    if (beamIds.length) return { type: "beam", id: beamIds[0] };
    if (plateIds.length) return { type: "plate", id: plateIds[0] };
    const [type, [id]] = loadEntries[0];
    return { type, id } as OpenFem3DSingleSelection;
  }
  return {
    type: "multi", nodeIds, beamIds,
    ...(plateIds.length ? { plateIds } : {}),
    ...(loadCount ? { loads } : {}),
  };
}

/** Ctrl/Shift/Meta-click voegt toe of verwijdert; een gewone klik vervangt. */
export function toggleOpenFem3DSelection(
  current: OpenFem3DSelection,
  item: OpenFem3DSingleSelection,
  additive: boolean,
): OpenFem3DSelection {
  if (!additive) return item;
  if (item.type === "envelopePanel") return item;
  // Belastingen krijgen een eigen, eenduidige eigenschappenselectie. Een
  // gemengde groepsbewerking met geometrie is niet zinvol.
  if (isLoadType(item.type)) return item;
  const nodeIds = new Set<number>();
  const beamIds = new Set<number>();
  const plateIds = new Set<number>();
  if (current?.type === "node") nodeIds.add(current.id);
  else if (current?.type === "beam") beamIds.add(current.id);
  else if (current?.type === "plate") plateIds.add(current.id);
  else if (current?.type === "multi") {
    current.nodeIds.forEach((id) => nodeIds.add(id));
    current.beamIds.forEach((id) => beamIds.add(id));
    current.plateIds?.forEach((id) => plateIds.add(id));
  }
  const target = item.type === "node" ? nodeIds : item.type === "beam" ? beamIds : plateIds;
  if (target.has(item.id)) target.delete(item.id);
  else target.add(item.id);
  // Lasten uit het selectiefilter blijven bij een klik op geometrie staan.
  return openFem3DSelectionFromIds({
    nodeIds: [...nodeIds], beamIds: [...beamIds], plateIds: [...plateIds],
    loads: current?.type === "multi" ? current.loads : undefined,
  });
}
