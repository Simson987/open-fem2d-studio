import type { OpenFem3DTool } from "./openFem3dCommands";
import { normalizeOpenFem3DSymbolPercent, OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT } from "./openFem3dSymbolScale";
import {
  DEFAULT_OPEN_FEM_3D_PLATE_DISPLAY, openFem3DPlateDisplayFromSaved, type OpenFem3DPlateDisplay,
} from "./openFem3dPlateDisplay";
import {
  DEFAULT_OPEN_FEM_3D_SECTION_BOX, normalizeOpenFem3DSectionBox, type OpenFem3DSectionBox,
} from "./openFem3dSectionBox";

/** Display preferences for the 3D workspace; they do not change project geometry. */
export interface OpenFem3DVisibility {
  nodes: boolean;
  beams: boolean;
  plates: boolean;
  /**
   * Hoe een plaat getekend wordt (issue #78): als volume met haar dikte, als
   * vlak (alleen het middenvlak) of als mesh (de elementen op het middenvlak).
   * Geen aan/uit-vlag; de schakelaar `plates` staat er los van. Vervangt de
   * oude schakelaar `mesh` (overname: openFem3dPlateDisplay.ts).
   */
  plateDisplay: OpenFem3DPlateDisplay;
  /** Volumetric member representation; off shows slender analytical axes. */
  profiles: boolean;
  /**
   * "Profielen in kleur": elk profiel een eigen kleur (volume én hartlijn), met
   * een legenda. De unity-checkkleuring gaat voor (lib/profielKleur.ts).
   */
  profileColors: boolean;
  nodeNumbers: boolean;
  beamNumbers: boolean;
  nodeCoordinates: boolean;
  supports: boolean;
  loads: boolean;
  /** Belastingvlakken (arcering, lastpijlen, overspanning); samen met `loads`. */
  loadPanels: boolean;
  grid: boolean;
  axes: boolean;
  /** Local x/y/z directions on each member. */
  memberAxes: boolean;
  /**
   * De view cube (aanzichtkubus) rechtsboven, met zijn menu. Uit: geen kubus,
   * geen menu en geen voor labels gereserveerde plek.
   */
  viewCube: boolean;
  /**
   * Perspectief (aan) of parallelle projectie (uit). Uit wisselt het tekenvlak
   * naar een orthografische camera met hetzelfde doel, dezelfde kijkrichting
   * en dezelfde zichtbare grootte (openFem3dProjectie.ts).
   */
  perspective: boolean;
  structuralGrid: boolean;
  /**
   * Peilmaten bij de levels (issue #92): streepje, peildriehoekje en de
   * peilmaat van 2D ("+3,50 m"). Los van het stramien: ook met het stramien
   * uit (openFem3dPeilmaten.ts).
   */
  levelMarks: boolean;
  deformation: boolean;
  reactions: boolean;
  /** Colour members and show labels for EN 1992 / EN 1993 unity checks. */
  utilization: boolean;
  axialForce: boolean;
  shearY: boolean;
  shearZ: boolean;
  torsion: boolean;
  momentY: boolean;
  momentZ: boolean;
  /**
   * Gronddruk onder staven op bedding (issue #106): de lijnlast van de grond
   * op de staaf (kN/m), getekend als lijn onder de staaf; stukken zonder
   * contact (alleen druk) grijs gestippeld.
   */
  groundPressure: boolean;
  /**
   * Grootte van de knoopbollen in % van de automatische straal (issue #82):
   * 25–400, standaard 100. Ook de kiesstraal en de scharnierbolletjes volgen.
   * Geen aan/uit-vlag ({@link OPEN_FEM_3D_SYMBOL_SCALE_KEYS}).
   */
  nodeSizePercent: number;
  /** Grootte van de opleggingssymbolen in % van de automatische maat (issue #82): 25–400, standaard 100. */
  supportSizePercent: number;
  /**
   * De section box (issue #86): aan/uit en de grenzen in m. Alleen wat
   * binnen de doos valt is zichtbaar, kiesbaar en snapbaar. Hoort bij de
   * weergave: bewaard met de zichtbaarheid en in opgeslagen views. Geen
   * aan/uit-vlag ({@link OPEN_FEM_3D_VISIBILITY_FLAGS}); een vast object dat bij
   * elke wijziging vervangen wordt (zie openFem3dSectionBox.ts).
   */
  sectionBox: OpenFem3DSectionBox;
}

export const DEFAULT_OPEN_FEM_3D_VISIBILITY: OpenFem3DVisibility = {
  nodes: true,
  beams: true,
  plates: true,
  plateDisplay: DEFAULT_OPEN_FEM_3D_PLATE_DISPLAY,
  profiles: false,
  profileColors: false,
  nodeNumbers: true,
  beamNumbers: false,
  nodeCoordinates: false,
  supports: true,
  loads: true,
  loadPanels: true,
  grid: true,
  axes: true,
  memberAxes: false,
  viewCube: true,
  perspective: true,
  structuralGrid: true,
  levelMarks: true,
  deformation: true,
  reactions: true,
  utilization: true,
  axialForce: false,
  shearY: false,
  shearZ: false,
  torsion: false,
  momentY: false,
  momentZ: false,
  groundPressure: false,
  nodeSizePercent: OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT,
  supportSizePercent: OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT,
  sectionBox: DEFAULT_OPEN_FEM_3D_SECTION_BOX,
};

/** De twee schalen van issue #82: getallen in % (openFem3dSymbolScale.ts), geen aan/uit-vlaggen. */
export const OPEN_FEM_3D_SYMBOL_SCALE_KEYS = ["nodeSizePercent", "supportSizePercent"] as const;
export type OpenFem3DSymbolScaleKey = (typeof OPEN_FEM_3D_SYMBOL_SCALE_KEYS)[number];
/** Een laag die aan of uit staat: alles behalve de schalen, de plaatweergave en de section box. */
export type OpenFem3DVisibilityFlag = Exclude<keyof OpenFem3DVisibility, OpenFem3DSymbolScaleKey | "plateDisplay" | "sectionBox">;

export function isOpenFem3DSymbolScaleKey(key: string): key is OpenFem3DSymbolScaleKey {
  return (OPEN_FEM_3D_SYMBOL_SCALE_KEYS as readonly string[]).includes(key);
}

/** De aan/uit-vlaggen, in de volgorde van de verkenner en het venster. */
export const OPEN_FEM_3D_VISIBILITY_FLAGS: readonly OpenFem3DVisibilityFlag[] = (
  Object.keys(DEFAULT_OPEN_FEM_3D_VISIBILITY) as (keyof OpenFem3DVisibility)[]
).filter((key): key is OpenFem3DVisibilityFlag => !isOpenFem3DSymbolScaleKey(key) && key !== "plateDisplay" && key !== "sectionBox");

/**
 * Bewaarde zichtbaarheid (browseropslag of een opgeslagen view) → een geldige
 * zichtbaarheid. Per vlag alleen een boolean, anders de standaard; per schaal
 * het begrensde percentage, ontbrekend of ongeldig 100 %; de plaatweergave
 * een van de drie standen, met de eenmalige overname van de oude schakelaar
 * `mesh` (mesh: true zonder plateDisplay → "mesh"). Een oudere opslag zonder
 * een nieuwe sleutel krijgt zo de standaard; `mesh` zelf valt weg. De section
 * box (issue #86): ontbrekend of ongeldig is uit.
 */
export function normalizeOpenFem3DVisibility(value: unknown): OpenFem3DVisibility {
  const result = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const saved = value as Record<string, unknown>;
  for (const key of OPEN_FEM_3D_VISIBILITY_FLAGS) {
    const entry = saved[key];
    if (typeof entry === "boolean") result[key] = entry;
  }
  for (const key of OPEN_FEM_3D_SYMBOL_SCALE_KEYS) result[key] = normalizeOpenFem3DSymbolPercent(saved[key]);
  result.plateDisplay = openFem3DPlateDisplayFromSaved(saved);
  result.sectionBox = normalizeOpenFem3DSectionBox(saved.sectionBox);
  return result;
}

/**
 * Een ander 3D-model (openen, nieuw, omzetten, stalen hal, bedieningskanaal):
 * de section box (issue #86) uit en zonder grenzen. Zijn grenzen horen bij
 * het vorige model; aan laten zou het nieuwe model (deels) verbergen. Weer
 * aan neemt dan de grenzen van het nieuwe model. Zonder doos: hetzelfde object.
 */
export function openFem3DVisibilityZonderSectionBox(visibility: OpenFem3DVisibility): OpenFem3DVisibility {
  return visibility.sectionBox.enabled || visibility.sectionBox.bounds
    ? { ...visibility, sectionBox: DEFAULT_OPEN_FEM_3D_SECTION_BOX } : visibility;
}

/**
 * De resultaatlagen. Ze staan in de verkenner onder Resultaten, niet onder
 * Weergave; de overige lagen zijn modellagen (zoals in 2D, issue #47).
 */
export const OPEN_FEM_3D_RESULT_LAYERS: readonly OpenFem3DVisibilityFlag[] = [
  "deformation", "reactions", "utilization", "axialForce", "shearY", "shearZ", "torsion", "momentY", "momentZ",
  "groundPressure",
];

const STORAGE_KEY = "open-fem-studio.openFem3d.visibility";

export function readOpenFem3DVisibility(): OpenFem3DVisibility {
  if (typeof localStorage === "undefined") return { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
  try {
    return normalizeOpenFem3DVisibility(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
  }
}

export function saveOpenFem3DVisibility(value: OpenFem3DVisibility): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private browsing or a full store must not interrupt drawing.
  }
}

/**
 * Wat een gereedschap in beeld moet hebben: bij een belastingvlak de lasten
 * en de belastingvlakken, bij Puntlast de lasten (#77; de nieuwe last moet je
 * zien), bij Scharnier aan staafeind de staven (#93; het eind klik je op de
 * staaf aan en het scharnierbolletje staat op de staaf). Staat het al aan,
 * dan komt dezelfde zichtbaarheid terug.
 */
export function openFem3DVisibilityForTool(visibility: OpenFem3DVisibility, tool: OpenFem3DTool): OpenFem3DVisibility {
  if (tool === "addLoadPanel" && !(visibility.loads && visibility.loadPanels)) {
    return { ...visibility, loads: true, loadPanels: true };
  }
  if (tool === "addPointLoad" && !visibility.loads) return { ...visibility, loads: true };
  if (tool === "beamEndHinge" && !visibility.beams) return { ...visibility, beams: true };
  return visibility;
}
