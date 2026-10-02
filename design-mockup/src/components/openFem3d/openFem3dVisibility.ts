/** Display preferences for the 3D workspace; they do not change project geometry. */
export interface OpenFem3DVisibility {
  nodes: boolean;
  beams: boolean;
  plates: boolean;
  /** Elementverdeling (rekennet) van de platen tonen. */
  mesh: boolean;
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
}

export const DEFAULT_OPEN_FEM_3D_VISIBILITY: OpenFem3DVisibility = {
  nodes: true,
  beams: true,
  plates: true,
  mesh: false,
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
  deformation: true,
  reactions: true,
  utilization: true,
  axialForce: false,
  shearY: false,
  shearZ: false,
  torsion: false,
  momentY: false,
  momentZ: false,
};

/**
 * De resultaatlagen. Ze staan in de verkenner onder Resultaten, niet onder
 * Weergave; de overige lagen zijn modellagen (zoals in 2D, issue #47).
 */
export const OPEN_FEM_3D_RESULT_LAYERS: readonly (keyof OpenFem3DVisibility)[] = [
  "deformation", "reactions", "utilization", "axialForce", "shearY", "shearZ", "torsion", "momentY", "momentZ",
];

const STORAGE_KEY = "open-fem-studio.openFem3d.visibility";

export function readOpenFem3DVisibility(): OpenFem3DVisibility {
  if (typeof localStorage === "undefined") return { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Record<string, unknown> | null;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
    const result = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
    for (const key of Object.keys(result) as (keyof OpenFem3DVisibility)[]) {
      if (typeof saved[key] === "boolean") result[key] = saved[key];
    }
    return result;
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
