import type { OpenFem3DModel } from "./openFem3dModel";
import { openFem3DSelectionFromIds, type OpenFem3DSelection } from "./openFem3dSelection";

/** Model layer 0 also exists implicitly in projects saved before layers. */
export interface OpenFem3DLayer {
  id: number;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export const OPEN_FEM_3D_DEFAULT_LAYER: OpenFem3DLayer = {
  id: 0, name: "Default", color: "#3b82f6", visible: true, locked: false,
};

export function parseOpenFem3DLayers(value: unknown): OpenFem3DLayer[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Het 3D-model bevat geen geldige lijst lagen.");
  const ids = new Set<number>();
  const names = new Set<string>();
  const layers = value.map((item): OpenFem3DLayer => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige laag.");
    const raw = item as Record<string, unknown>;
    const id = raw.id;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const color = raw.color;
    if (!Number.isSafeInteger(id) || Number(id) < 0 || ids.has(Number(id))
      || !name || names.has(name.toLocaleLowerCase())
      || typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)
      || typeof raw.visible !== "boolean" || typeof raw.locked !== "boolean") {
      throw new Error("Het 3D-model bevat een laag met ongeldige of dubbele id, naam, kleur of status.");
    }
    ids.add(Number(id));
    names.add(name.toLocaleLowerCase());
    return { id: Number(id), name, color: color.toLowerCase(), visible: raw.visible, locked: raw.locked };
  });
  if (!ids.has(0)) layers.unshift({ ...OPEN_FEM_3D_DEFAULT_LAYER });
  return layers.sort((a, b) => a.id - b.id);
}

export function readOpenFem3DLayerId(value: unknown, layers: readonly OpenFem3DLayer[], label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || !layers.some((layer) => layer.id === value)) {
    throw new Error(`${label} verwijst naar een ongeldige of ontbrekende laag.`);
  }
  return Number(value) === 0 ? undefined : Number(value);
}

export function openFem3DLayer(model: Pick<OpenFem3DModel, "layers">, id: number | undefined): OpenFem3DLayer {
  return model.layers?.find((layer) => layer.id === (id ?? 0)) ?? OPEN_FEM_3D_DEFAULT_LAYER;
}

/** Detect an edit that changes an object on a locked layer, including moving it away. */
export function changedLockedOpenFem3DLayer(before: OpenFem3DModel, after: OpenFem3DModel): OpenFem3DLayer | null {
  const oldLocked = new Map((before.layers ?? [OPEN_FEM_3D_DEFAULT_LAYER]).filter((layer) => layer.locked)
    .map((layer) => [layer.id, layer]));
  const newLocked = new Map((after.layers ?? [OPEN_FEM_3D_DEFAULT_LAYER]).filter((layer) => layer.locked)
    .map((layer) => [layer.id, layer]));
  if (!oldLocked.size && !newLocked.size) return null;
  for (const key of ["nodes", "beams", "plates", "supports", "loads", "memberLoads",
    "memberPointLoads", "thermalLoads", "surfaceLoads", "loadPanels", "envelopePanels"] as const) {
    const idKey = key === "supports" ? "nodeId" : "id";
    const previous = (before[key] ?? []) as Array<{ id?: number; nodeId?: number; layerId?: number }>;
    const current = (after[key] ?? []) as Array<{ id?: number; nodeId?: number; layerId?: number }>;
    if (previous === current) continue;
    const oldById = new Map(previous.map((item) => [item[idKey], item]));
    const newById = new Map(current.map((item) => [item[idKey], item]));
    for (const item of previous) {
      const layer = oldLocked.get(item.layerId ?? 0);
      if (layer) {
        const next = newById.get(item[idKey]);
        if (!next || (next !== item && JSON.stringify(next) !== JSON.stringify(item))) return layer;
      }
    }
    for (const item of current) {
      const layer = newLocked.get(item.layerId ?? 0);
      if (layer) {
        const old = oldById.get(item[idKey]);
        if (!old || (old !== item && JSON.stringify(old) !== JSON.stringify(item))) return layer;
      }
    }
  }
  return null;
}

/** Layer edits are a single model change, hence one undo step. */
export function updateOpenFem3DLayer(
  model: OpenFem3DModel, id: number, patch: Partial<Pick<OpenFem3DLayer, "name" | "color" | "visible" | "locked">>,
): OpenFem3DModel {
  const layers = parseOpenFem3DLayers(model.layers ?? [OPEN_FEM_3D_DEFAULT_LAYER])!;
  if (!layers.some((layer) => layer.id === id)) throw new Error(`Laag ${id} bestaat niet.`);
  return { ...model, layers: parseOpenFem3DLayers(layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer))! };
}

export function addOpenFem3DLayer(model: OpenFem3DModel, name: string, color = "#6b7280"): OpenFem3DModel {
  const layers = parseOpenFem3DLayers(model.layers ?? [OPEN_FEM_3D_DEFAULT_LAYER])!;
  const id = Math.max(...layers.map((layer) => layer.id)) + 1;
  return { ...model, layers: parseOpenFem3DLayers([...layers, { id, name, color, visible: true, locked: false }])! };
}

export function removeOpenFem3DLayer(model: OpenFem3DModel, id: number): OpenFem3DModel {
  if (id === 0) throw new Error("De standaardlaag kan niet worden verwijderd.");
  if (!model.layers?.some((layer) => layer.id === id)) throw new Error(`Laag ${id} bestaat niet.`);
  const reset = <T extends { layerId?: number }>(items: T[] | undefined): T[] | undefined =>
    items?.map((item) => item.layerId === id ? { ...item, layerId: undefined } : item);
  return {
    ...model, layers: model.layers.filter((layer) => layer.id !== id),
    nodes: reset(model.nodes)!, beams: reset(model.beams)!,
    plates: reset(model.plates), supports: reset(model.supports), loads: reset(model.loads),
    memberLoads: reset(model.memberLoads), memberPointLoads: reset(model.memberPointLoads),
    thermalLoads: reset(model.thermalLoads), surfaceLoads: reset(model.surfaceLoads),
    loadPanels: reset(model.loadPanels), envelopePanels: reset(model.envelopePanels),
  };
}

/** Move the current geometry and load selection in one undoable model change. */
export function assignOpenFem3DSelectionToLayer(
  model: OpenFem3DModel, selection: OpenFem3DSelection, id: number,
): OpenFem3DModel {
  const target = openFem3DLayer(model, id);
  if (target.id !== id) throw new Error(`Laag ${id} bestaat niet.`);
  if (target.locked) throw new Error(`Laag ${id} is vergrendeld.`);
  if (!selection) return model;
  const ids = (type: string): Set<number> => {
    if (selection.type !== "multi") return selection.type === type ? new Set([selection.id]) : new Set();
    if (type === "node") return new Set(selection.nodeIds);
    if (type === "beam") return new Set(selection.beamIds);
    if (type === "plate") return new Set(selection.plateIds);
    return new Set(selection.loads?.[type as keyof NonNullable<typeof selection.loads>] ?? []);
  };
  const move = <T extends { id: number; layerId?: number }>(items: T[] | undefined, type: string): T[] | undefined => {
    const selected = ids(type);
    return items?.map((item) => selected.has(item.id)
      ? { ...item, layerId: id === 0 ? undefined : id } : item);
  };
  return {
    ...model,
    nodes: move(model.nodes, "node")!, beams: move(model.beams, "beam")!,
    plates: move(model.plates, "plate"), loads: move(model.loads, "nodalLoad"),
    memberLoads: move(model.memberLoads, "memberLoad"),
    memberPointLoads: move(model.memberPointLoads, "memberPointLoad"),
    thermalLoads: move(model.thermalLoads, "thermalLoad"),
    surfaceLoads: move(model.surfaceLoads, "surfaceLoad"),
    loadPanels: move(model.loadPanels, "loadPanel"),
  };
}

/** Select geometry and loads assigned to a layer; the analysis model is untouched. */
export function openFem3DSelectionForLayer(model: OpenFem3DModel, id: number): OpenFem3DSelection {
  const on = (item: { layerId?: number }) => (item.layerId ?? 0) === id;
  return openFem3DSelectionFromIds({
    nodeIds: model.nodes.filter(on).map((item) => item.id),
    beamIds: model.beams.filter(on).map((item) => item.id),
    plateIds: (model.plates ?? []).filter(on).map((item) => item.id),
    loads: {
      nodalLoad: (model.loads ?? []).filter(on).map((item) => item.id),
      memberLoad: (model.memberLoads ?? []).filter(on).map((item) => item.id),
      memberPointLoad: (model.memberPointLoads ?? []).filter(on).map((item) => item.id),
      thermalLoad: (model.thermalLoads ?? []).filter(on).map((item) => item.id),
      surfaceLoad: (model.surfaceLoads ?? []).filter(on).map((item) => item.id),
      loadPanel: (model.loadPanels ?? []).filter(on).map((item) => item.id),
    },
  });
}
