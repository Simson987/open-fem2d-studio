/**
 * openFem3dBedding.ts — staaf op bedding in 3D (issue #106): wat de app met de
 * uitkomst van de rekenkern doet. Het rekenen zelf (veren k·b, fijn knippen,
 * alleen druk) gebeurt in de kern; hier alleen lezen, kiezen en omzetten voor
 * weergave en rapport. De modelregels (keuren, zetten en weghalen) staan in
 * openFem3dModel.ts (`readOpenFem3DBeamBedding`, `setOpenFem3DBeamBedding`).
 *
 * Zuiver: geen React, geen Three.
 */
import {
  OpenFem3DBeddingVerticalError, openFem3DBeddingAllRound, type OpenFem3DBeamBedding, type OpenFem3DModel, type OpenFem3DNode,
} from "./openFem3dModel";
import type { OpenFem3DBeddingMemberResult, OpenFem3DBeddingPoint, OpenFem3DDiagramPoint, OpenFem3DSolveResult } from "./openFem3dSolver";

/** Standaard beddingsconstante bij aanvinken, zoals in de 2D-staafdialoog (kN/m³). */
export const OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3 = 50_000;

/** De bedding-uitkomst van één staaf, of undefined (geen bedding, of een kern zonder bedding-uitvoer). */
export function openFem3DBeddingResultOf(
  result: Pick<OpenFem3DSolveResult, "bedding"> | null | undefined,
  memberId: number,
): OpenFem3DBeddingMemberResult | undefined {
  return result?.bedding?.find((item) => item.memberId === memberId);
}

/** De gronddruklijn van een staaf: pressureKnPerM per punt (kN/m, positief omhoog op de staaf). */
export function openFem3DBeddingPressurePoints(
  result: Pick<OpenFem3DSolveResult, "bedding"> | null | undefined,
  memberId: number,
): OpenFem3DDiagramPoint[] {
  return openFem3DBeddingResultOf(result, memberId)?.points.map((point) => ({ t: point.t, value: point.pressureKnPerM })) ?? [];
}

/** De zakking (m, positief omlaag) op t, lineair tussen de punten van de kern; buiten de punten de rand. */
export function openFem3DBeddingSettlementAt(member: Pick<OpenFem3DBeddingMemberResult, "points">, t: number): number {
  const points = member.points;
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0].settlementM;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    if (t <= right.t) {
      const left = points[index - 1];
      const span = right.t - left.t;
      return span > 1e-12 ? left.settlementM + (right.settlementM - left.settlementM) * (t - left.t) / span : right.settlementM;
    }
  }
  return points[points.length - 1].settlementM;
}

/**
 * De veerlengte per punt (m): de halve stukken aan weerszijden, aan de einden
 * één half stuk; samen de staaflengte. De kern zet de grondveren op zijn
 * knopen met k·b maal deze lengte (zoals in 2D: kL/2 per elementeinde), dus de
 * veerkracht in een punt is pressureKnPerM × deze lengte.
 */
export function openFem3DBeddingTributaryLengths(points: readonly Pick<OpenFem3DBeddingPoint, "t">[], lengthM: number): number[] {
  return points.map((point, index) => {
    const left = index > 0 ? (point.t - points[index - 1].t) / 2 : 0;
    const right = index < points.length - 1 ? (points[index + 1].t - point.t) / 2 : 0;
    return (left + right) * lengthM;
  });
}

/**
 * De stukken zonder contact (alleen druk), als [t0, t1]: het gebied van elk
 * inactief punt (tot halverwege zijn buren), aaneengesloten samengevoegd.
 */
export function openFem3DBeddingLiftedRuns(member: Pick<OpenFem3DBeddingMemberResult, "points">): [number, number][] {
  const points = member.points;
  const runs: [number, number][] = [];
  points.forEach((point, index) => {
    if (point.active) return;
    const from = index > 0 ? (points[index - 1].t + point.t) / 2 : point.t;
    const to = index < points.length - 1 ? (point.t + points[index + 1].t) / 2 : point.t;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last[1] - from) < 1e-12) last[1] = to;
    else runs.push([from, to]);
  });
  return runs.filter(([from, to]) => to - from > 1e-12);
}

/**
 * Heeft een staaf met een zijdelingse bedding rondom (steiler dan 45°, een
 * (schoor)paal) zijdelingse grondkrachten? Daar geeft de kern alleen de
 * grootte van de resultante loodrecht op de as, niet de richting; de
 * onafhankelijke krachtensom kan ze dan niet meenemen. (Bij een vlakkere staaf
 * is het de component langs n = Z × e_x; die telt wel mee, zie
 * openFem3DGlobalForceBalance.)
 */
export function openFem3DBeddingPileLateralForces(
  input: { nodes: readonly Pick<OpenFem3DNode, "id" | "x" | "y" | "z">[]; members: readonly { id: number; startNodeId: number; endNodeId: number }[] },
  result: Pick<OpenFem3DSolveResult, "bedding"> | null | undefined,
): boolean {
  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  return (result?.bedding ?? []).some((member) => {
    const definition = input.members.find((item) => item.id === member.memberId);
    return definition !== undefined && openFem3DBeddingAllRound(definition, nodes)
      && member.points.some((point) => Math.abs(point.lateralKnPerM ?? 0) > 1e-9);
  });
}

/** De melding als de onafhankelijke krachtensom door de zijdelingse bedding van een paal niet na te rekenen is. */
export const OPEN_FEM_3D_BEDDING_LATERAL_BALANCE_NOTICE =
  "Zijdelingse bedding van een (schoor)paal: de onafhankelijke kracht- en momentensom is niet nagerekend, want het resultaat geeft daar alleen de grootte van de grondkracht, niet de richting. Het evenwicht van de rekenkern zelf geldt.";

/**
 * Een geweigerde bewerking van de geometrie omdat een staaf op een verticale
 * bedding (k) verticaal zou komen te staan: de vertaalsleutel met het
 * staafnummer, of null bij een andere melding (die toont de aanroeper zelf).
 */
export function openFem3DBeddingRefusal(reason: unknown): { key: string; values: { id: number } } | null {
  return reason instanceof OpenFem3DBeddingVerticalError
    ? { key: "openFem3d.bedding.verticalRefused", values: { id: reason.beamId } }
    : null;
}

/** Eén regel van het rapport: de invoer van een staaf op bedding en wat de kern ervan maakte. */
export interface OpenFem3DBeddingSummaryRow {
  beamId: number;
  kKnPerM3: number | null;
  widthMm: number;
  kLateralKnPerM3: number | null;
  compressionOnly: boolean;
  /** Null zonder uitkomst, of als de kern geen bedding-uitvoer gaf. */
  result: null | {
    maxSettlementMm: number;
    maxPressureKnPerM: number;
    /** De grootste gronddruk gedeeld door de contactbreedte b. */
    maxPressureKnPerM2: number;
    minPressureKnPerM: number;
    liftedPercent: number;
    totalReactionKn: number;
    /** De grootste zijdelingse lijnlast (grootte), of null zonder. */
    maxLateralKnPerM: number | null;
  };
}

/** Per staaf op bedding (in modelvolgorde) de regel voor het rapport. */
export function openFem3DBeddingSummary(
  model: Pick<OpenFem3DModel, "beams">,
  result: Pick<OpenFem3DSolveResult, "bedding"> | null | undefined,
): OpenFem3DBeddingSummaryRow[] {
  return model.beams.flatMap((beam) => {
    const bedding: OpenFem3DBeamBedding | undefined = beam.bedding;
    if (!bedding) return [];
    const member = openFem3DBeddingResultOf(result, beam.id);
    const laterals = member?.points.flatMap((point) => point.lateralKnPerM === undefined ? [] : [Math.abs(point.lateralKnPerM)]) ?? [];
    return [{
      beamId: beam.id,
      kKnPerM3: bedding.kKnPerM3 ?? null,
      widthMm: bedding.widthM * 1000,
      kLateralKnPerM3: bedding.kLateralKnPerM3 ?? null,
      compressionOnly: bedding.compressionOnly === true,
      result: member ? {
        maxSettlementMm: member.maxSettlementM * 1000,
        maxPressureKnPerM: member.maxPressureKnPerM,
        maxPressureKnPerM2: member.maxPressureKnPerM / bedding.widthM,
        minPressureKnPerM: member.minPressureKnPerM,
        liftedPercent: member.liftedFraction * 100,
        totalReactionKn: member.totalReactionKn,
        maxLateralKnPerM: laterals.length > 0 ? Math.max(...laterals) : null,
      } : null,
    }];
  });
}
