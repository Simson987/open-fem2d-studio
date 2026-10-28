import type { OpenFem3DView } from "./openFem3dCommands";
import { normalizeOpenFem3DVisibility, type OpenFem3DVisibility } from "./openFem3dVisibility";
import { normalizeOpenFem3DDiagramLabels, type OpenFem3DDiagramLabels } from "./openFem3dDiagramLabels";

export interface OpenFem3DCameraState {
  /**
   * In parallelle projectie de positie van de perspectiefcamera met dezelfde
   * zichtbare grootte bij het doel (d = h / tan(fov/2)); zie openFem3dProjectie.ts.
   */
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  /**
   * Alleen in parallelle projectie (zichtbaarheid perspective = uit): de halve
   * hoogte (m) van het zichtbare frustum. Ontbreekt in perspectief en in
   * oudere views; dan volgt de schaal uit de afstand positie–doel.
   */
  orthoHalfHeight?: number;
}

/** Classificeer het zichtbare aanzicht uit de camera, niet uit de laatst gekozen knop. */
export function openFem3DViewFromCamera(
  position: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
): OpenFem3DView {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 1e-9)) return "iso";
  if (Math.abs(dz / length) > 0.985) return "top";
  if (Math.abs(dy / length) > 0.985) return "front";
  if (Math.abs(dx / length) > 0.985) return "side";
  return "iso";
}

/** Een projectgebonden, benoemde 3D-weergave. */
export interface OpenFem3DViewSet {
  id: string;
  name: string;
  view: OpenFem3DView;
  camera: OpenFem3DCameraState;
  visibility: OpenFem3DVisibility;
  /** null = het actieve belastinggeval; anders de id van een combinatie. */
  combinationId: number | null;
  /** Belastinggeval dat bij deze weergave actief was. */
  loadCaseId?: number;
  /** Ontbreekt in oudere projectbestanden; die behouden de huidige tab bij toepassen. */
  mode?: "model" | "loadCase" | "results";
  /**
   * Komt deze view als afbeelding in het berekeningsrapport? Ontbreekt = ja:
   * een eigen view maak je om hem te tonen, ook in oudere projectbestanden.
   */
  inRapport?: boolean;
  /**
   * De getallen bij de snedekrachtlijnen (Waarden, stand 1 … 5). Ontbreekt in
   * oudere views; die tonen bij toepassen de standaard (aan, stand 3).
   */
  diagramLabels?: OpenFem3DDiagramLabels;
}

/**
 * De zes standaardviews van de tab Views (openFem3dStandaardViews.ts), in vaste
 * volgorde. Hier gedefinieerd omdat het projectbestand hun rapportkeuze leest.
 */
export type OpenFem3DStandaardViewId = "geometrie" | "belastingen" | "combinaties" | "vz" | "reacties" | "spanningen";
export const OPEN_FEM_3D_STANDAARD_VIEW_IDS: readonly OpenFem3DStandaardViewId[] = [
  "geometrie", "belastingen", "combinaties", "vz", "reacties", "spanningen",
];

/**
 * De standaardviews die NIET in het rapport komen (projectveld
 * `openFem3dStandaardViewsUitRapport`). Bekende ids, in vaste volgorde, zonder
 * dubbele; iets anders valt weg — dan staat die view weer gewoon aan.
 */
export function parseOpenFem3DStandaardViewsUitRapport(value: unknown): OpenFem3DStandaardViewId[] {
  if (!Array.isArray(value)) return [];
  return OPEN_FEM_3D_STANDAARD_VIEW_IDS.filter((id) => value.includes(id));
}

/** Staat een eigen view in het rapport (ontbrekend veld = ja)? */
export function openFem3DViewSetInRapport(viewSet: Pick<OpenFem3DViewSet, "inRapport">): boolean {
  return viewSet.inRapport !== false;
}

/** Wat "huidige weergave opslaan" vastlegt (venster Views en de verkenner, tab Views). */
export interface OpenFem3DHuidigeWeergave {
  view: OpenFem3DView;
  camera: OpenFem3DCameraState;
  visibility: OpenFem3DVisibility;
  combinationId: number | null;
  loadCaseId: number;
  mode: "model" | "loadCase" | "results";
  /** De getallen bij de snedekrachtlijnen; zonder: de view krijgt geen veld (toepassen geeft de standaard). */
  diagramLabels?: OpenFem3DDiagramLabels;
}

const zelfdeNaam = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * De huidige weergave als view opslaan. Bestaat de naam al (hoofdletters
 * tellen niet), dan wordt die view bijgewerkt en houdt hij zijn id en zijn
 * rapportkeuze; anders komt er een nieuwe bij. Een lege naam doet niets.
 */
export function bewaarOpenFem3DViewSet(
  viewSets: readonly OpenFem3DViewSet[], naam: string, huidig: OpenFem3DHuidigeWeergave,
): OpenFem3DViewSet[] {
  const trimmed = naam.trim();
  if (!trimmed) return [...viewSets];
  const bestaand = viewSets.find((item) => zelfdeNaam(item.name, trimmed));
  const viewSet: OpenFem3DViewSet = {
    id: bestaand?.id ?? newOpenFem3DViewSetId(viewSets),
    name: trimmed,
    view: huidig.view,
    camera: {
      position: [...huidig.camera.position], target: [...huidig.camera.target], up: [...huidig.camera.up],
      ...(huidig.camera.orthoHalfHeight === undefined ? {} : { orthoHalfHeight: huidig.camera.orthoHalfHeight }),
    },
    visibility: { ...huidig.visibility },
    combinationId: huidig.combinationId,
    loadCaseId: huidig.loadCaseId,
    mode: huidig.mode,
    ...(bestaand?.inRapport === undefined ? {} : { inRapport: bestaand.inRapport }),
    ...(huidig.diagramLabels === undefined ? {} : { diagramLabels: { ...huidig.diagramLabels } }),
  };
  return bestaand
    ? viewSets.map((item) => item.id === bestaand.id ? viewSet : item)
    : [...viewSets, viewSet];
}

/** Hernoemen; geweigerd bij een lege naam of een naam die een andere view al heeft. */
export function hernoemOpenFem3DViewSet(
  viewSets: readonly OpenFem3DViewSet[], id: string, naam: string,
): { viewSets: OpenFem3DViewSet[]; fout: "leeg" | "bestaat" | null } {
  const trimmed = naam.trim();
  if (!trimmed) return { viewSets: [...viewSets], fout: "leeg" };
  if (viewSets.some((item) => item.id !== id && zelfdeNaam(item.name, trimmed))) return { viewSets: [...viewSets], fout: "bestaat" };
  return { viewSets: viewSets.map((item) => item.id === id ? { ...item, name: trimmed } : item), fout: null };
}

export function verwijderOpenFem3DViewSet(viewSets: readonly OpenFem3DViewSet[], id: string): OpenFem3DViewSet[] {
  return viewSets.filter((item) => item.id !== id);
}

export function zetOpenFem3DViewSetInRapport(
  viewSets: readonly OpenFem3DViewSet[], id: string, inRapport: boolean,
): OpenFem3DViewSet[] {
  return viewSets.map((item) => item.id === id ? { ...item, inRapport } : item);
}

const VIEWS: readonly OpenFem3DView[] = ["iso", "top", "front", "side"];

function vector3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

export function parseOpenFem3DViewSets(value: unknown): OpenFem3DViewSet[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("De opgeslagen 3D-weergaven zijn ongeldig.");
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Een opgeslagen 3D-weergave is ongeldig.");
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `view-${index + 1}`;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Weergave ${index + 1}`;
    const view = VIEWS.includes(raw.view as OpenFem3DView) ? raw.view as OpenFem3DView : "iso";
    const cameraRaw = raw.camera as Record<string, unknown> | undefined;
    const position = vector3(cameraRaw?.position), target = vector3(cameraRaw?.target), up = vector3(cameraRaw?.up);
    if (!position || !target || !up || ids.has(id)) throw new Error("Een opgeslagen 3D-weergave heeft een ongeldige camera of dubbele id.");
    // De schaal van een parallelle view; een ongeldige waarde valt weg (dan
    // geldt de afstand positie–doel, zoals bij een oudere view).
    const orthoRaw = cameraRaw?.orthoHalfHeight;
    const orthoHalfHeight = typeof orthoRaw === "number" && Number.isFinite(orthoRaw) && orthoRaw > 0 ? orthoRaw : undefined;
    const savedVisibility = raw.visibility;
    if (!savedVisibility || typeof savedVisibility !== "object" || Array.isArray(savedVisibility)) {
      throw new Error("Een opgeslagen 3D-weergave mist de zichtbaarheidsinstellingen.");
    }
    // Dezelfde parser als de bewaarde zichtbaarheid: een ontbrekende vlag de
    // standaard, de grootte van knopen en opleggingen (issue #82) begrensd,
    // in een oudere view zonder die velden 100 %.
    const visibility = normalizeOpenFem3DVisibility(savedVisibility);
    const combinationId = raw.combinationId === null || raw.combinationId === undefined
      ? null
      : Number.isSafeInteger(raw.combinationId) && Number(raw.combinationId) > 0
        ? Number(raw.combinationId)
        : (() => { throw new Error("Een opgeslagen 3D-weergave verwijst naar een ongeldige resultaatcombinatie."); })();
    const loadCaseId = raw.loadCaseId === undefined ? undefined
      : Number.isSafeInteger(raw.loadCaseId) && Number(raw.loadCaseId) > 0
        ? Number(raw.loadCaseId)
        : (() => { throw new Error("Een opgeslagen 3D-weergave verwijst naar een ongeldig belastinggeval."); })();
    const mode = raw.mode;
    if (mode !== undefined && mode !== "model" && mode !== "loadCase" && mode !== "results") {
      throw new Error("Een opgeslagen 3D-weergave heeft een ongeldige tabstand.");
    }
    ids.add(id);
    return { id, name, view, camera: { position, target, up, ...(orthoHalfHeight === undefined ? {} : { orthoHalfHeight }) },
      visibility, combinationId,
      ...(loadCaseId === undefined ? {} : { loadCaseId }),
      ...(mode === undefined ? {} : { mode }),
      ...(typeof raw.inRapport === "boolean" ? { inRapport: raw.inRapport } : {}),
      // Optioneel; een ongeldige waarde wordt per veld de standaard.
      ...(raw.diagramLabels === undefined ? {} : { diagramLabels: normalizeOpenFem3DDiagramLabels(raw.diagramLabels) }) };
  });
}

export function newOpenFem3DViewSetId(existing: readonly OpenFem3DViewSet[]): string {
  const used = new Set(existing.map((item) => item.id));
  let serial = 1;
  while (used.has(`view-${serial}`)) serial += 1;
  return `view-${serial}`;
}
