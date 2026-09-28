import type { Frame3DView } from "./frame3dCommands";
import { DEFAULT_FRAME_3D_VISIBILITY, type Frame3DVisibility } from "./frame3dVisibility";

export interface Frame3DCameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

/** Een projectgebonden, benoemde 3D-weergave. */
export interface Frame3DViewSet {
  id: string;
  name: string;
  view: Frame3DView;
  camera: Frame3DCameraState;
  visibility: Frame3DVisibility;
  /** null = het actieve belastinggeval; anders de id van een combinatie. */
  combinationId: number | null;
  /** Ontbreekt in oudere projectbestanden; die behouden de huidige tab bij toepassen. */
  mode?: "model" | "loadCase" | "results";
}

const VIEWS: readonly Frame3DView[] = ["iso", "top", "front", "side"];

function vector3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

export function parseFrame3DViewSets(value: unknown): Frame3DViewSet[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("De opgeslagen 3D-weergaven zijn ongeldig.");
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Een opgeslagen 3D-weergave is ongeldig.");
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `view-${index + 1}`;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Weergave ${index + 1}`;
    const view = VIEWS.includes(raw.view as Frame3DView) ? raw.view as Frame3DView : "iso";
    const cameraRaw = raw.camera as Record<string, unknown> | undefined;
    const position = vector3(cameraRaw?.position), target = vector3(cameraRaw?.target), up = vector3(cameraRaw?.up);
    if (!position || !target || !up || ids.has(id)) throw new Error("Een opgeslagen 3D-weergave heeft een ongeldige camera of dubbele id.");
    const savedVisibility = raw.visibility;
    if (!savedVisibility || typeof savedVisibility !== "object" || Array.isArray(savedVisibility)) {
      throw new Error("Een opgeslagen 3D-weergave mist de zichtbaarheidsinstellingen.");
    }
    const visibility = { ...DEFAULT_FRAME_3D_VISIBILITY };
    for (const key of Object.keys(visibility) as (keyof Frame3DVisibility)[]) {
      const entry = (savedVisibility as Record<string, unknown>)[key];
      if (typeof entry === "boolean") visibility[key] = entry;
    }
    const combinationId = raw.combinationId === null || raw.combinationId === undefined
      ? null
      : Number.isSafeInteger(raw.combinationId) && Number(raw.combinationId) > 0
        ? Number(raw.combinationId)
        : (() => { throw new Error("Een opgeslagen 3D-weergave verwijst naar een ongeldige resultaatcombinatie."); })();
    const mode = raw.mode;
    if (mode !== undefined && mode !== "model" && mode !== "loadCase" && mode !== "results") {
      throw new Error("Een opgeslagen 3D-weergave heeft een ongeldige tabstand.");
    }
    ids.add(id);
    return { id, name, view, camera: { position, target, up }, visibility, combinationId,
      ...(mode === undefined ? {} : { mode }) };
  });
}

export function newFrame3DViewSetId(existing: readonly Frame3DViewSet[]): string {
  const used = new Set(existing.map((item) => item.id));
  let serial = 1;
  while (used.has(`view-${serial}`)) serial += 1;
  return `view-${serial}`;
}
