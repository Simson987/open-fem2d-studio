/**
 * Plaatresultaten van de 3D-kern voor tekenvlak, eigenschappenpaneel en
 * rapport: welke grootheden er zijn, hun eenheid en hoe ze uit een
 * knoopresultaat gelezen worden. Alle waarden staan in plaatassen (zie de
 * Rust-adapter): z = plaatnormaal (bij een vloer omhoog, bij een wand staat
 * y omhoog), momenten positief bij trek aan de onderzijde.
 */
import type { OpenFem3DShellNodeResult, OpenFem3DSolveResult } from "./openFem3dSolver";

export type OpenFem3DPlateQuantity =
  | "w" | "mxx" | "myy" | "mxy" | "nxx" | "nyy" | "nxy" | "vx" | "vy" | "vonMisesTop" | "vonMisesBottom";

export interface OpenFem3DPlateQuantityDefinition {
  key: OpenFem3DPlateQuantity;
  /** Formulesymbool voor legenda en tabel. */
  symbol: string;
  unit: string;
  /** Naam in `PlateSummary3D.extremes` van de kern. */
  extremeKey: string;
  /** Knoopwaarde in de getoonde eenheid; `undefined` als de kern hem niet levert. */
  read: (node: OpenFem3DShellNodeResult) => number | undefined;
  /** Omrekening van de kernwaarde in `extremes` naar de getoonde eenheid. */
  factor: number;
}

export const OPEN_FEM_3D_PLATE_QUANTITIES: readonly OpenFem3DPlateQuantityDefinition[] = [
  { key: "w", symbol: "w", unit: "mm", extremeKey: "wM", factor: 1000, read: (n) => n.wM * 1000 },
  { key: "mxx", symbol: "mxx", unit: "kNm/m", extremeKey: "mxxKnmPerM", factor: 1, read: (n) => n.mxxKnmPerM },
  { key: "myy", symbol: "myy", unit: "kNm/m", extremeKey: "myyKnmPerM", factor: 1, read: (n) => n.myyKnmPerM },
  { key: "mxy", symbol: "mxy", unit: "kNm/m", extremeKey: "mxyKnmPerM", factor: 1, read: (n) => n.mxyKnmPerM },
  { key: "nxx", symbol: "nxx", unit: "kN/m", extremeKey: "nxxKnPerM", factor: 1, read: (n) => n.nxxKnPerM },
  { key: "nyy", symbol: "nyy", unit: "kN/m", extremeKey: "nyyKnPerM", factor: 1, read: (n) => n.nyyKnPerM },
  { key: "nxy", symbol: "nxy", unit: "kN/m", extremeKey: "nxyKnPerM", factor: 1, read: (n) => n.nxyKnPerM },
  { key: "vx", symbol: "vx", unit: "kN/m", extremeKey: "vxKnPerM", factor: 1, read: (n) => n.vxKnPerM },
  { key: "vy", symbol: "vy", unit: "kN/m", extremeKey: "vyKnPerM", factor: 1, read: (n) => n.vyKnPerM },
  { key: "vonMisesTop", symbol: "σvm,boven", unit: "N/mm²", extremeKey: "vonMisesTopMpa", factor: 1, read: (n) => n.vonMisesTopMpa },
  { key: "vonMisesBottom", symbol: "σvm,onder", unit: "N/mm²", extremeKey: "vonMisesBottomMpa", factor: 1, read: (n) => n.vonMisesBottomMpa },
];

export function openFem3DPlateQuantity(key: OpenFem3DPlateQuantity): OpenFem3DPlateQuantityDefinition {
  return OPEN_FEM_3D_PLATE_QUANTITIES.find((item) => item.key === key)!;
}

export function isOpenFem3DPlateQuantity(value: unknown): value is OpenFem3DPlateQuantity {
  return OPEN_FEM_3D_PLATE_QUANTITIES.some((item) => item.key === value);
}

/** Bereik van een grootheid over alle plaatknopen van het resultaat (voor één legenda). */
export function openFem3DPlateQuantityRange(
  result: Pick<OpenFem3DSolveResult, "shellNodes"> | null | undefined,
  quantity: OpenFem3DPlateQuantity,
): { min: number; max: number } | null {
  const definition = openFem3DPlateQuantity(quantity);
  let min = Infinity, max = -Infinity;
  for (const node of result?.shellNodes ?? []) {
    const value = definition.read(node);
    if (value === undefined || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

/**
 * Kleurschaal van blauw (minimum) via cyaan, groen en geel naar rood
 * (maximum) — dezelfde stops als de spanningscontouren van de 2D-platen.
 */
const STOPS: [number, number, number][] = [
  [37, 99, 235], [6, 182, 212], [16, 185, 129], [245, 158, 11], [220, 38, 38],
];

export function openFem3DContourColor(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0.5));
  const segment = Math.min(STOPS.length - 2, Math.floor(clamped * (STOPS.length - 1)));
  const f = clamped * (STOPS.length - 1) - segment;
  const a = STOPS[segment], b = STOPS[segment + 1];
  return [0, 1, 2].map((i) => (a[i] + (b[i] - a[i]) * f) / 255) as [number, number, number];
}

/** CSS-gradiënt voor de legenda. */
export function openFem3DContourGradientCss(): string {
  return `linear-gradient(90deg, ${STOPS.map((c, i) => `rgb(${c.join(",")}) ${(i / (STOPS.length - 1) * 100).toFixed(0)}%`).join(", ")})`;
}

/** Getal voor legenda en tabel: drie significante cijfers, NL-notatie. */
export function formatOpenFem3DPlateValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 1 : magnitude >= 10 ? 2 : 3;
  return value.toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Uiterste waarden van één plaat, in de getoonde eenheden. */
export function openFem3DPlateExtremes(
  result: OpenFem3DSolveResult | null | undefined,
  plateId: number,
): { definition: OpenFem3DPlateQuantityDefinition; min: number; minNodeId: number; max: number; maxNodeId: number }[] {
  const summary = result?.plates?.find((plate) => plate.plateId === plateId);
  if (!summary) return [];
  return OPEN_FEM_3D_PLATE_QUANTITIES.flatMap((definition) => {
    const extreme = summary.extremes.find((item) => item.quantity === definition.extremeKey);
    if (!extreme) return [];
    return [{
      definition,
      min: extreme.min * definition.factor,
      minNodeId: extreme.minNodeId,
      max: extreme.max * definition.factor,
      maxNodeId: extreme.maxNodeId,
    }];
  });
}

const STORAGE_KEY = "open-fem-studio.openFem3d.plateQuantity";

/** De gekozen contourgrootheid per gebruiker (`null` = geen contour). */
export function readOpenFem3DPlateQuantity(): OpenFem3DPlateQuantity | null {
  if (typeof localStorage === "undefined") return "mxx";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "none") return null;
    return isOpenFem3DPlateQuantity(saved) ? saved : "mxx";
  } catch {
    return "mxx";
  }
}

export function saveOpenFem3DPlateQuantity(value: OpenFem3DPlateQuantity | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, value ?? "none");
  } catch {
    // Privémodus of volle opslag mag het tekenen niet onderbreken.
  }
}
