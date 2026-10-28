import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import { openFem3DMaximumDisplacementM } from "./openFem3dDisplacement";

/**
 * Weergave van de vervormde vorm in 3D: de vergrotingsfactor van de
 * verplaatsingen en of de onvervormde staven en platen erachter te zien zijn.
 * Een weergavevoorkeur van de gebruiker (onthouden in de browser), geen
 * modelgegeven.
 */
export interface OpenFem3DDeformationDisplay {
  /** "auto": de grootste verplaatsing wordt 12 % van de modelmaat; anders een vaste factor. */
  scale: "auto" | number;
  /** Onvervormde staven en platen als lichte schim achter de vervormde vorm (anders weg). */
  showOriginal: boolean;
}

export const DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY: OpenFem3DDeformationDisplay = { scale: "auto", showOriginal: true };

/** Schuifregelaar: logaritmisch van 1× tot 1000×. */
export const OPEN_FEM_3D_DEFORMATION_SCALE_MIN = 1;
export const OPEN_FEM_3D_DEFORMATION_SCALE_MAX = 1000;
/** Standen van de schuifregelaar: 0 … 300, één decade per 100 stappen. */
export const OPEN_FEM_3D_DEFORMATION_SLIDER_STEPS = 300;

const STORAGE_KEY = "open-fem-studio.openFem3d.deformation";

/** De automatische factor, zoals het tekenvlak hem altijd gebruikte. */
export function openFem3DAutoDeformationScale(model: OpenFem3DModel, result: OpenFem3DSolveResult): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const node of model.nodes) {
    minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
    minZ = Math.min(minZ, node.z); maxZ = Math.max(maxZ, node.z);
  }
  const diagonal = model.nodes.length > 0 ? Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) : 0;
  const modelSize = Math.max(diagonal, 1);
  const maxDisplacement = openFem3DMaximumDisplacementM(model, result);
  return maxDisplacement > 1e-15 ? Math.min(10_000, modelSize * 0.12 / maxDisplacement) : 1;
}

/** De factor waarmee het tekenvlak de verplaatsingen vergroot. */
export function openFem3DDeformationScale(display: OpenFem3DDeformationDisplay, autoScale: number): number {
  return display.scale === "auto" ? autoScale : display.scale;
}

function clampScale(scale: number): number {
  return Math.min(OPEN_FEM_3D_DEFORMATION_SCALE_MAX, Math.max(OPEN_FEM_3D_DEFORMATION_SCALE_MIN, scale));
}

/** Stand van de schuifregelaar → factor (1 … 1000, logaritmisch; "mooie" afronding op 2 cijfers). */
export function openFem3DDeformationScaleFromSlider(position: number): number {
  const step = Math.min(OPEN_FEM_3D_DEFORMATION_SLIDER_STEPS, Math.max(0, Math.round(position)));
  const raw = OPEN_FEM_3D_DEFORMATION_SCALE_MIN * 10 ** (step / 100);
  const digits = raw >= 100 ? 0 : raw >= 10 ? 1 : 2;
  return clampScale(Number(raw.toFixed(digits)));
}

/** Factor → stand van de schuifregelaar (een factor buiten 1 … 1000 staat aan de rand). */
export function openFem3DDeformationSliderFromScale(scale: number): number {
  if (!(scale > 0)) return 0;
  return Math.round(100 * Math.log10(clampScale(scale) / OPEN_FEM_3D_DEFORMATION_SCALE_MIN));
}

/** Leesbare factor: ×1,5 · ×24 · ×350 (Nederlandse komma). */
export function formatOpenFem3DDeformationScale(scale: number): string {
  const digits = scale >= 10 ? 0 : scale >= 1 ? 1 : 2;
  return `×${scale.toFixed(digits).replace(".", ",")}`;
}

export function readOpenFem3DDeformationDisplay(): OpenFem3DDeformationDisplay {
  if (typeof localStorage === "undefined") return { ...DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Record<string, unknown> | null;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY };
    const scale = saved.scale === "auto" ? "auto"
      : typeof saved.scale === "number" && Number.isFinite(saved.scale) && saved.scale > 0 ? clampScale(saved.scale)
        : DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY.scale;
    const showOriginal = typeof saved.showOriginal === "boolean" ? saved.showOriginal : DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY.showOriginal;
    return { scale, showOriginal };
  } catch {
    return { ...DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY };
  }
}

export function saveOpenFem3DDeformationDisplay(value: OpenFem3DDeformationDisplay): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Privé venster of volle opslag: de keuze geldt dan alleen deze sessie.
  }
}
