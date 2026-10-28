/**
 * Plaatweergave in 3D (issue #78): één keuze hoe een plaat getekend wordt.
 *
 *  - "volume":  de plaat met haar dikte (zoals altijd), zonder elementlijnen.
 *  - "surface": alleen het middenvlak, dun en halfdoorzichtig, met de omtrek
 *               en de openingen als lijn; geen dikte.
 *  - "mesh":    de elementen van het rekennet als lijnen op het middenvlak,
 *               met een licht gevuld vlak eronder (zo blijft de plaat
 *               herkenbaar en kiesbaar).
 *
 * De schakelaar Platen (aan/uit) staat hier los van. Geen Three.js: de
 * zichtbaarheid (en daarmee deze module) zit ook in de sidecarbundel.
 */

export const OPEN_FEM_3D_PLATE_DISPLAYS = ["volume", "surface", "mesh"] as const;
export type OpenFem3DPlateDisplay = (typeof OPEN_FEM_3D_PLATE_DISPLAYS)[number];
export const DEFAULT_OPEN_FEM_3D_PLATE_DISPLAY: OpenFem3DPlateDisplay = "volume";

export function isOpenFem3DPlateDisplay(value: unknown): value is OpenFem3DPlateDisplay {
  return typeof value === "string" && (OPEN_FEM_3D_PLATE_DISPLAYS as readonly string[]).includes(value);
}

/**
 * De plaatweergave uit een bewaarde zichtbaarheid of opgeslagen view, met de
 * eenmalige overname van de oude schakelaar `mesh`:
 *  - een geldige `plateDisplay` is leidend;
 *  - staat er een `plateDisplay` die niet geldig is: "volume";
 *  - zonder `plateDisplay`: `mesh: true` → "mesh", anders "volume".
 * Bij het bewaren gaat alleen `plateDisplay` mee; `mesh` verdwijnt dan.
 */
export function openFem3DPlateDisplayFromSaved(saved: Readonly<Record<string, unknown>>): OpenFem3DPlateDisplay {
  if (saved.plateDisplay !== undefined) {
    return isOpenFem3DPlateDisplay(saved.plateDisplay) ? saved.plateDisplay : DEFAULT_OPEN_FEM_3D_PLATE_DISPLAY;
  }
  return saved.mesh === true ? "mesh" : DEFAULT_OPEN_FEM_3D_PLATE_DISPLAY;
}

/** Hoe het tekenvlak een plaat in een stand tekent. */
export interface OpenFem3DPlateDisplayStyle {
  /** Zonder dikte: alleen het middenvlak (Vlak en Mesh). */
  flat: boolean;
  /** Vulkleur van het vlak (of volume). */
  color: number;
  /** Dekking van het vlak; geselecteerd de tweede waarde. */
  opacity: number;
  selectionOpacity: number;
  /** Dekking van de omtreklijnen (randen van het volume, of omtrek en openingen). */
  edgeOpacity: number;
  /** De elementlijnen van het rekennet tekenen (alleen bij Mesh). */
  showMesh: boolean;
}

export const OPEN_FEM_3D_PLATE_DISPLAY_STYLES: Readonly<Record<OpenFem3DPlateDisplay, OpenFem3DPlateDisplayStyle>> = {
  // Precies de oude tekening: kleur, dekking en randen zoals voorheen.
  volume: { flat: false, color: 0x94a3b8, opacity: 0.7, selectionOpacity: 0.88, edgeOpacity: 0.78, showMesh: false },
  // Dun en halfdoorzichtig; de omtrek iets krachtiger, want hij draagt de vorm.
  surface: { flat: true, color: 0x7d8ea5, opacity: 0.42, selectionOpacity: 0.7, edgeOpacity: 0.95, showMesh: false },
  // Een licht gevuld vlak onder de elementlijnen: herkenbaar en kiesbaar.
  mesh: { flat: true, color: 0x94a3b8, opacity: 0.22, selectionOpacity: 0.55, edgeOpacity: 0.95, showMesh: true },
};

/**
 * Hoe ver het getekende plaatvlak in een stand van het middenvlak ligt: in
 * Volume de halve dikte (boven- en onderzijde), in Vlak en Mesh 0 (alleen het
 * middenvlak). Wat net buiten de plaat hoort (het vlak van een
 * oppervlaktelast) rekent hiermee, zodat het in elke stand even dicht bij de
 * getekende plaat ligt.
 */
export function openFem3DPlateDrawnHalfThickness(thicknessM: number, display: OpenFem3DPlateDisplay): number {
  return OPEN_FEM_3D_PLATE_DISPLAY_STYLES[display]?.flat ? 0 : thicknessM / 2;
}
