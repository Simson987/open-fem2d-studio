export type Frame3DSelectionType =
  | "node" | "beam"
  | "plate" | "volume" | "nodalLoad" | "memberLoad" | "memberPointLoad" | "thermalLoad" | "surfaceLoad";
export type Frame3DSingleSelection = {
  [Type in Frame3DSelectionType]: { type: Type; id: number }
}[Frame3DSelectionType];
export type Frame3DMultiSelection = { type: "multi"; nodeIds: number[]; beamIds: number[]; plateIds?: number[] };
export type Frame3DSelection = Frame3DSingleSelection | Frame3DMultiSelection | null;

export function frame3DSelectionContains(
  selection: Frame3DSelection,
  type: Frame3DSelectionType,
  id: number,
): boolean {
  if (!selection) return false;
  if (selection.type === type) return selection.id === id;
  if (selection.type !== "multi") return false;
  if (type === "node") return selection.nodeIds.includes(id);
  if (type === "beam") return selection.beamIds.includes(id);
  if (type === "plate") return (selection.plateIds ?? []).includes(id);
  return false;
}

export function frame3DSelectionCount(selection: Frame3DSelection): number {
  if (!selection) return 0;
  return selection.type === "multi" ? selection.nodeIds.length + selection.beamIds.length + (selection.plateIds?.length ?? 0) : 1;
}

/** Ctrl/Shift/Meta-click voegt toe of verwijdert; een gewone klik vervangt. */
export function toggleFrame3DSelection(
  current: Frame3DSelection,
  item: Frame3DSingleSelection,
  additive: boolean,
): Frame3DSelection {
  if (!additive) return item;
  // Belastingen krijgen een eigen, eenduidige eigenschappenselectie. Een
  // gemengde groepsbewerking met geometrie is niet zinvol.
  if (item.type !== "node" && item.type !== "beam" && item.type !== "plate") return item;
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
  const nodes = [...nodeIds].sort((a, b) => a - b);
  const beams = [...beamIds].sort((a, b) => a - b);
  const plates = [...plateIds].sort((a, b) => a - b);
  if (nodes.length + beams.length + plates.length === 0) return null;
  if (nodes.length === 1 && beams.length === 0 && plates.length === 0) return { type: "node", id: nodes[0] };
  if (beams.length === 1 && nodes.length === 0 && plates.length === 0) return { type: "beam", id: beams[0] };
  if (plates.length === 1 && nodes.length === 0 && beams.length === 0) return { type: "plate", id: plates[0] };
  return { type: "multi", nodeIds: nodes, beamIds: beams, ...(plates.length ? { plateIds: plates } : {}) };
}
