/**
 * openFem3dPlateBedding.ts — plaat op bedding in 3D (issue #107): wat de app
 * met de uitkomst van de rekenkern doet. Het rekenen zelf (de veren k·A_trib
 * op de knopen van het rekennet, alleen druk) gebeurt in de kern; hier alleen
 * lezen, kiezen en omzetten voor weergave, rapport en de onafhankelijke
 * krachtensom. De modelregels (keuren, zetten en weghalen) staan in
 * openFem3dModel.ts (`readOpenFem3DPlateBedding`, `setOpenFem3DPlateBedding`).
 *
 * Zuiver: geen React, geen Three.
 */
import type { OpenFem3DModel, OpenFem3DNode, OpenFem3DPlate, OpenFem3DPlateBedding } from "./openFem3dModel";
import { OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3 } from "./openFem3dBedding";
import type { OpenFem3DPlateBeddingResult, OpenFem3DSolveResult } from "./openFem3dSolver";

type V3 = [number, number, number];

/** Standaard beddingsconstante bij aanvinken: dezelfde als bij de staafbedding (kN/m³). */
export const OPEN_FEM_3D_PLATE_BEDDING_DEFAULT_K_KN_PER_M3 = OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3;

/** De bedding-uitkomst van één plaat, of undefined (geen bedding, of een kern zonder plaatbedding-uitvoer). */
export function openFem3DPlateBeddingResultOf(
  result: Pick<OpenFem3DSolveResult, "plateBedding"> | null | undefined,
  plateId: number,
): OpenFem3DPlateBeddingResult | undefined {
  return result?.plateBedding?.find((item) => item.plateId === plateId);
}

/** Gausspunten van de 2 × 2-regel (gewicht 1): exact voor ∫N_i·det J over een vlakke vierhoek. */
const GAUSS = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
/** Natuurlijke coördinaten van de vier hoeken (rondgaand), zoals de MITC4-vormfuncties. */
const HOEKEN: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/**
 * Het tributaire oppervlak per knoop van het rekennet (m²): per element de
 * consistente ∫N_i dA met de bilineaire vormfuncties van het vierhoekige
 * element, opgeteld over de aansluitende elementen. Samen is dat precies het
 * oppervlak van de elementen (de plaat min de openingen); bij een rechthoekig
 * element is het een kwart per hoek. Dezelfde verdeling als de kern voor de
 * grondveren k·A_trib gebruikt, zodat de veerkracht in een knoop
 * pressureKnPerM2 × A_trib is.
 */
export function openFem3DPlateBeddingTributaryAreas(
  elements: readonly { nodeIds: readonly number[] }[],
  position: (nodeId: number) => readonly number[] | undefined,
): Map<number, number> {
  const areas = new Map<number, number>();
  for (const element of elements) {
    const points = element.nodeIds.map((id) => {
      const p = position(id);
      if (!p) throw new Error(`Knoop ${id} van een plaatelement ontbreekt bij het tributaire oppervlak.`);
      return p;
    });
    if (points.length !== 4) throw new Error("Een plaatelement heeft vier knopen nodig voor het tributaire oppervlak.");
    for (const xi of GAUSS) {
      for (const eta of GAUSS) {
        // ∂x/∂ξ en ∂x/∂η; det J = |∂x/∂ξ × ∂x/∂η| (de vierhoek ligt vlak, in de ruimte).
        const dXi: V3 = [0, 0, 0], dEta: V3 = [0, 0, 0];
        HOEKEN.forEach(([a, b], k) => {
          for (let axis = 0; axis < 3; axis += 1) {
            dXi[axis] += a * (1 + b * eta) / 4 * points[k][axis];
            dEta[axis] += b * (1 + a * xi) / 4 * points[k][axis];
          }
        });
        const det = Math.hypot(
          dXi[1] * dEta[2] - dXi[2] * dEta[1], dXi[2] * dEta[0] - dXi[0] * dEta[2], dXi[0] * dEta[1] - dXi[1] * dEta[0]);
        HOEKEN.forEach(([a, b], k) => {
          const n = (1 + a * xi) * (1 + b * eta) / 4;
          const id = element.nodeIds[k];
          areas.set(id, (areas.get(id) ?? 0) + n * det);
        });
      }
    }
  }
  return areas;
}

/**
 * De z-as van de plaatassen bij een (niet genormeerde) plaatnormaal, volgens
 * de afspraak van de kern (`plate_axes` in de Rust-adapter): bij een plaat die
 * niet verticaal staat wijst z omhoog (z·Z > 0); bij een wand zo dat de y-as
 * (z × x, met x langs globaal X of anders Y) omhoog wijst.
 */
export function openFem3DPlateAxisZ(normal: readonly number[]): V3 {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(length > 0)) return [0, 0, 1];
  let z: V3 = [normal[0] / length, normal[1] / length, normal[2] / length];
  const project = (axis: V3): V3 => {
    const d = axis[0] * z[0] + axis[1] * z[1] + axis[2] * z[2];
    return [axis[0] - d * z[0], axis[1] - d * z[1], axis[2] - d * z[2]];
  };
  let x = project([1, 0, 0]);
  if (Math.hypot(...x) < 1e-3) x = project([0, 1, 0]);
  if (Math.abs(z[2]) > 1e-6) {
    if (z[2] < 0) z = [-z[0], -z[1], -z[2]];
  } else if (z[0] * x[1] - z[1] * x[0] < 0) {
    // (z × x)·Z < 0: de y-as wijst omlaag; keer z om.
    z = [-z[0], -z[1], -z[2]];
  }
  return z;
}

/**
 * De kant van de grond onder een plaat op bedding: tegen de plaatnormaal in
 * (de z-as van de plaatassen, zie {@link openFem3DPlateAxisZ}); bij een vloer
 * globaal −Z, bij een wand de kant die de kern kiest. Null als de plaat geen
 * vlak heeft (minder dan drie bruikbare hoeken).
 */
export function openFem3DPlateGroundDirection(
  model: Pick<OpenFem3DModel, "nodes">,
  plate: Pick<OpenFem3DPlate, "nodeIds">,
  nodeIndex?: ReadonlyMap<number, Pick<OpenFem3DNode, "x" | "y" | "z">>,
): V3 | null {
  const byId = nodeIndex ?? new Map(model.nodes.map((node) => [node.id, node]));
  const points = plate.nodeIds.map((id) => byId.get(id)).filter((node) => node !== undefined);
  if (points.length < 3) return null;
  // Newell: de oppervlaktevector van de omtrek.
  const normal: V3 = [0, 0, 0];
  points.forEach((p, index) => {
    const q = points[(index + 1) % points.length]!;
    normal[0] += (p!.y - q.y) * (p!.z + q.z);
    normal[1] += (p!.z - q.z) * (p!.x + q.x);
    normal[2] += (p!.x - q.x) * (p!.y + q.y);
  });
  if (!(Math.hypot(...normal) > 1e-12)) return null;
  const z = openFem3DPlateAxisZ(normal);
  return [-z[0] || 0, -z[1] || 0, -z[2] || 0];
}

/** De grondzijde van een plaat op bedding, in woorden en als richting. */
export interface OpenFem3DPlateGroundSide {
  /** Eenheidsvector naar de grond (tegen de plaatnormaal in). */
  direction: V3;
  /**
   * Staat de plaat verticaal (een wand; |z·Z| ≤ 10⁻⁶, dezelfde grens als de
   * kern)? Dan legt de assenafspraak de grondzijde vast, los van de
   * knoopvolgorde: een wand in het XZ-vlak heeft de grond aan +Y, een wand in
   * het YZ-vlak aan −X. Die zijde is in het rekencontract niet te kiezen.
   */
  vertical: boolean;
  /** "+Y", "−X", "−Z" langs een globale as, anders de richting "(0.71; −0.71; 0.00)". */
  side: string;
}

/**
 * De grondzijde van een plaat op bedding (zie {@link openFem3DPlateGroundDirection}),
 * met de vraag of het een wand is. Null als de plaat geen vlak heeft.
 */
export function openFem3DPlateGroundSide(
  model: Pick<OpenFem3DModel, "nodes">,
  plate: Pick<OpenFem3DPlate, "nodeIds">,
  nodeIndex?: ReadonlyMap<number, Pick<OpenFem3DNode, "x" | "y" | "z">>,
): OpenFem3DPlateGroundSide | null {
  const direction = openFem3DPlateGroundDirection(model, plate, nodeIndex);
  if (!direction) return null;
  const axis = [0, 1, 2].find((index) => Math.abs(Math.abs(direction[index]) - 1) <= 1e-9);
  const side = axis !== undefined
    ? `${direction[axis] > 0 ? "+" : "−"}${"XYZ"[axis]}`
    : `(${direction.map((c) => (Math.abs(c) < 5e-3 ? 0 : c).toFixed(2).replace("-", "−")).join("; ")})`;
  return { direction, vertical: Math.abs(direction[2]) <= 1e-6, side };
}

/** Eén regel van het rapport: de invoer van een plaat op bedding en wat de kern ervan maakte. */
export interface OpenFem3DPlateBeddingSummaryRow {
  plateId: number;
  kKnPerM3: number;
  compressionOnly: boolean;
  /** Null zonder uitkomst, of als de kern geen plaatbedding-uitvoer gaf. */
  result: null | {
    maxSettlementMm: number;
    maxPressureKnPerM2: number;
    minPressureKnPerM2: number;
    liftedPercent: number;
    totalReactionKn: number;
  };
}

/** Per plaat op bedding (in modelvolgorde) de regel voor het rapport. */
export function openFem3DPlateBeddingSummary(
  model: Pick<OpenFem3DModel, "plates">,
  result: Pick<OpenFem3DSolveResult, "plateBedding"> | null | undefined,
): OpenFem3DPlateBeddingSummaryRow[] {
  return (model.plates ?? []).flatMap((plate) => {
    const bedding: OpenFem3DPlateBedding | undefined = plate.bedding;
    if (!bedding) return [];
    const plateResult = openFem3DPlateBeddingResultOf(result, plate.id);
    return [{
      plateId: plate.id,
      kKnPerM3: bedding.kKnPerM3,
      compressionOnly: bedding.compressionOnly === true,
      result: plateResult ? {
        maxSettlementMm: plateResult.maxSettlementM * 1000,
        maxPressureKnPerM2: plateResult.maxPressureKnPerM2,
        minPressureKnPerM2: plateResult.minPressureKnPerM2,
        liftedPercent: plateResult.liftedFraction * 100,
        totalReactionKn: plateResult.totalReactionKn,
      } : null,
    }];
  });
}
