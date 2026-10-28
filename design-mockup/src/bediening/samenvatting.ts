/**
 * samenvatting.ts — de samenvatting die het bedieningscommando `rekenen`
 * teruggeeft: per combinatie de uitersten van M, V, N en w.
 *
 * HET VELDMAXIMUM, NIET HET STATIONSMAXIMUM (issue #203, vervolg op #193).
 * Elke rekenstaaf heeft 21 stations. Het veldmaximum van M ligt waar V = 0 en
 * dat van de zakking waar θ = 0, meestal tussen twee stations. De omhullende,
 * het rapport en MCP nemen sinds #193 het exacte punt (`solver/veldExtremen.ts`);
 * deze samenvatting nam nog het grootste stationswaarde. Gemeten op geval 072
 * (ingeklemd-rol 6 m, q = 10 kN/m): 25,200 kNm waar 9qL²/128 = 25,3125 kNm
 * hoort, en w = 3,986 mm (station 3600) waar het maximum op x = 3471 mm ligt.
 * Nu dezelfde functies als de omhullende: `momentExtremen` voor M en
 * `zakkingPunten` voor w.
 *
 * Naast |M| (`M_max_kNm`, het grootste in absolute waarde, zoals altijd)
 * staan sinds #203 ook het grootste en het kleinste MET teken (`M_pos_kNm`,
 * `M_neg_kNm`, positief = veldmoment, zoals `bendingMoment`). Op geval 072 is
 * |M| het inklemmingsmoment qL²/8 = 45 kNm; het veldmaximum 9qL²/128 staat
 * dan in `M_pos_kNm`. Zo is het veldmaximum ook af te lezen als een
 * steunmoment groter is.
 *
 * V en N blijven stationswaarden: hun uitersten liggen op een station (een
 * staafeind, een knip of een sprong), niet tussen twee stations in.
 *
 * Zuiver: geen store en geen React, zodat een test hem rechtstreeks aanroept.
 */
import type { SolverResult } from "../components/fem/solver/types";
import { momentExtremen, zakkingPunten } from "../components/fem/solver/veldExtremen";

/** Per combinatie de uitersten: M_max, V, N en w als absolute waarde, M_pos/M_neg met teken. */
export interface CombinatieSamenvatting {
  combinatie: number;
  naam: string;
  /** Grootste |M| over alle staven (kNm). */
  M_max_kNm: number;
  /** Grootste M met teken (veldmoment positief), 0 als er geen positief moment is (kNm). */
  M_pos_kNm: number;
  /** Kleinste M met teken (steunmoment negatief), 0 als er geen negatief moment is (kNm). */
  M_neg_kNm: number;
  V_max_kN: number;
  N_max_kN: number;
  w_max_mm: number;
}

/** De velden van een staafresultaat die hier tellen; elk kan ontbreken. */
interface StaafReeksen {
  stations_mm?: number[];
  bendingMoment?: number[];
  shearForce?: number[];
  normalForce?: number[];
  axialForce?: number[];
  deflection?: number[];
  rotation?: number[];
}

function grootsteAbs(reeks: readonly number[] | undefined): number {
  let m = 0;
  for (const x of reeks ?? []) if (Number.isFinite(x) && Math.abs(x) > m) m = Math.abs(x);
  return m;
}

/**
 * Grootste en kleinste M van een staaf (N·mm, met teken), met het
 * veldmaximum tussen de stations (V = 0). Zonder even lange V-reeks blijft
 * het bij de stations.
 */
function staafMoment(e: StaafReeksen): { max: number; min: number } {
  let max = -Infinity, min = Infinity;
  for (const x of e.bendingMoment ?? []) {
    if (!Number.isFinite(x)) continue;
    if (x > max) max = x;
    if (x < min) min = x;
  }
  const n = e.stations_mm?.length ?? 0;
  if (n > 0 && e.bendingMoment?.length === n && e.shearForce?.length === n) {
    const veld = momentExtremen({
      stations_mm: e.stations_mm!, bendingMoment: e.bendingMoment, shearForce: e.shearForce,
    });
    if (veld) {
      max = Math.max(max, veld.max.M);
      min = Math.min(min, veld.min.M);
    }
  }
  return { max, min };
}

/** Grootste |w| van een staaf, met het punt waar θ = 0 tussen de stations. */
function staafZakkingMax(e: StaafReeksen): number {
  let w = grootsteAbs(e.deflection);
  const n = e.stations_mm?.length ?? 0;
  if (n > 0 && e.deflection?.length === n) {
    for (const p of zakkingPunten({ stations_mm: e.stations_mm!, deflection: e.deflection, rotation: e.rotation })) {
      w = Math.max(w, Math.abs(p.waarde));
    }
  }
  return w;
}

/** Per combinatie de uitersten — genoeg om te zien dát er gerekend is, en wat. */
export function combinatieSamenvatting(
  cr: Map<number, SolverResult>,
  combos: readonly { id: number; name: string }[],
): { combinaties: CombinatieSamenvatting[] } {
  const uit: CombinatieSamenvatting[] = [];
  for (const [id, r] of cr) {
    let mPos = 0, mNeg = 0, vMax = 0, nMax = 0, wMax = 0;
    // Via `unknown`: de veldnamen kunnen per pad verschillen (normalForce of
    // axialForce), en een reeks kan ontbreken.
    const els = (r as unknown as { elements?: Map<number, StaafReeksen> }).elements;
    if (els) {
      for (const e of els.values()) {
        const m = staafMoment(e);
        if (m.max > mPos) mPos = m.max;
        if (m.min < mNeg) mNeg = m.min;
        vMax = Math.max(vMax, grootsteAbs(e.shearForce));
        nMax = Math.max(nMax, grootsteAbs(e.axialForce ?? e.normalForce));
        wMax = Math.max(wMax, staafZakkingMax(e));
      }
    }
    uit.push({
      combinatie: id,
      naam: combos.find((c) => c.id === id)?.name ?? String(id),
      M_max_kNm: Math.max(mPos, -mNeg) / 1e6,
      M_pos_kNm: mPos / 1e6,
      M_neg_kNm: mNeg / 1e6,
      V_max_kN: vMax / 1e3,
      N_max_kN: nMax / 1e3,
      w_max_mm: wMax,
    });
  }
  return { combinaties: uit };
}
