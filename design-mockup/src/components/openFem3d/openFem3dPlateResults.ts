/**
 * Plaatresultaten van de 3D-kern voor tekenvlak, eigenschappenpaneel en
 * rapport: welke grootheden er zijn, hun eenheid en hoe ze uit een
 * knoopresultaat gelezen worden. Alle waarden staan in plaatassen (zie de
 * Rust-adapter): z = plaatnormaal (bij een vloer omhoog, bij een wand staat
 * y omhoog), momenten positief bij trek aan de onderzijde.
 *
 * Platen op bedding (issue #107) hebben er twee grootheden bij, Gronddruk en
 * Zakking; die komen niet uit `shellNodes` maar uit `plateBedding`, en alleen
 * platen op bedding hebben ze.
 */
import type {
  OpenFem3DPlateBeddingNode, OpenFem3DShellNodeResult, OpenFem3DSolveResult,
} from "./openFem3dSolver";

export type OpenFem3DPlateQuantity =
  | "w" | "mxx" | "myy" | "mxy" | "nxx" | "nyy" | "nxy" | "vx" | "vy" | "vonMisesTop" | "vonMisesBottom"
  | "groundPressure" | "settlement";

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
  /**
   * Een grootheid van de bedding (#107): de knoopwaarde uit `plateBedding` in
   * de getoonde eenheid. Dan geeft `read` niets en staat de grootheid niet in
   * de `extremes` van de kern.
   */
  bedding?: (node: OpenFem3DPlateBeddingNode) => number;
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
  // Plaat op bedding (#107): de gronddruk k·s (0 waar geen contact) en de zakking, positief de grond in.
  { key: "groundPressure", symbol: "p", unit: "kN/m²", extremeKey: "groundPressureKnPerM2", factor: 1, read: () => undefined,
    bedding: (n) => n.pressureKnPerM2 },
  { key: "settlement", symbol: "s", unit: "mm", extremeKey: "settlementM", factor: 1000, read: () => undefined,
    bedding: (n) => n.settlementM * 1000 },
];

export function openFem3DPlateQuantity(key: OpenFem3DPlateQuantity): OpenFem3DPlateQuantityDefinition {
  return OPEN_FEM_3D_PLATE_QUANTITIES.find((item) => item.key === key)!;
}

export function isOpenFem3DPlateQuantity(value: unknown): value is OpenFem3DPlateQuantity {
  return OPEN_FEM_3D_PLATE_QUANTITIES.some((item) => item.key === value);
}

/**
 * De knoopwaarden van een grootheid (in de getoonde eenheid) per knoop-id: van
 * één plaat, of zonder `plateId` van alle platen. De bestaande grootheden uit
 * `shellNodes`, Gronddruk en Zakking uit `plateBedding` (#107): een plaat
 * zonder bedding heeft die niet.
 */
export function openFem3DPlateQuantityValues(
  result: Pick<OpenFem3DSolveResult, "shellNodes" | "plateBedding"> | null | undefined,
  quantity: OpenFem3DPlateQuantity,
  plateId?: number,
): Map<number, number> {
  const definition = openFem3DPlateQuantity(quantity);
  const values = new Map<number, number>();
  if (definition.bedding) {
    for (const plate of result?.plateBedding ?? []) {
      if (plateId !== undefined && plate.plateId !== plateId) continue;
      for (const node of plate.nodes) {
        const value = definition.bedding(node);
        if (Number.isFinite(value)) values.set(node.nodeId, value);
      }
    }
    return values;
  }
  for (const node of result?.shellNodes ?? []) {
    if (plateId !== undefined && node.plateId !== plateId) continue;
    const value = definition.read(node);
    if (value !== undefined && Number.isFinite(value)) values.set(node.nodeId, value);
  }
  return values;
}

/**
 * De grootheden die een uitkomst heeft (voor de keuzelijst): de bestaande als
 * er plaatknopen zijn, Gronddruk en Zakking als er platen op bedding zijn.
 */
export function openFem3DPlateQuantitiesFor(
  result: Pick<OpenFem3DSolveResult, "shellNodes" | "plateBedding"> | null | undefined,
): OpenFem3DPlateQuantityDefinition[] {
  const shell = (result?.shellNodes?.length ?? 0) > 0;
  const bedding = (result?.plateBedding ?? []).some((plate) => plate.nodes.length > 0);
  return OPEN_FEM_3D_PLATE_QUANTITIES.filter((definition) => definition.bedding ? bedding : shell);
}

/** Bereik van een grootheid over alle plaatknopen van het resultaat (voor één legenda). */
export function openFem3DPlateQuantityRange(
  result: Pick<OpenFem3DSolveResult, "shellNodes" | "plateBedding"> | null | undefined,
  quantity: OpenFem3DPlateQuantity,
): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity;
  for (const value of openFem3DPlateQuantityValues(result, quantity).values()) {
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

/**
 * Getal voor legenda en tabel: minstens drie significante cijfers, NL-notatie.
 * Vanaf 1 vaste decimalen (3 onder 10, 2 onder 100, daarboven 1); onder 1
 * zoveel decimalen als drie significante cijfers vragen, zodat een klein
 * veldmoment niet tot één cijfer wegvalt (NAFEMS-bevinding B3: LE6, mxx =
 * 0,00822 kNm/m stond als "0,008"). Hooguit 10 decimalen: wat daaronder valt
 * is rekenruis en toont als 0.
 */
export function formatOpenFem3DPlateValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 1 : magnitude >= 10 ? 2 : magnitude >= 1 || magnitude === 0 ? 3
    : Math.min(10, Math.max(3, 2 - Math.floor(Math.log10(magnitude))));
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
    if (definition.bedding) {
      // Gronddruk en zakking (#107): uit de knopen van plateBedding (de kern zet ze niet in `extremes`).
      const bedding = result?.plateBedding?.find((plate) => plate.plateId === plateId);
      if (!bedding || bedding.nodes.length === 0) return [];
      let min = bedding.nodes[0], max = bedding.nodes[0];
      for (const node of bedding.nodes) {
        if (definition.bedding(node) < definition.bedding(min)) min = node;
        if (definition.bedding(node) > definition.bedding(max)) max = node;
      }
      return [{
        definition, min: definition.bedding(min), minNodeId: min.nodeId, max: definition.bedding(max), maxNodeId: max.nodeId,
      }];
    }
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
