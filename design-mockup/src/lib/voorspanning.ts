/**
 * Afgebakende elastische serviceberekening voor een rechte, voorgerekte pees.
 * Positief M veroorzaakt trek onder; e is positief onder het zwaartepunt.
 * Resultaten zijn doorsnedespanningen, geen volledige EN 1992-UGT-toets.
 */
export interface VoorspanDoorsnedeInvoer {
  oppervlakteMm2: number;
  iyMm4: number;
  hoogteMm: number;
  /** Effectieve peeskracht op de beschouwde plaats en tijd, N. */
  effectieveKrachtN: number;
  /** Peesexcentriciteit onder zwaartepunt, mm. */
  excentriciteitMm: number;
  /** Moment uit uitwendige belasting in dezelfde fase, Nmm. */
  uitwendigMomentNmm: number;
}

export interface VoorspanDoorsnedeUitkomst {
  /** Druk positief, N/mm². */
  sigmaBovenMpa: number;
  /** Druk positief, N/mm². */
  sigmaOnderMpa: number;
  decomprimerendMomentNmm: number;
  onderzijdeGedecomprimeerd: boolean;
}

export function voorspanSpanningen(i: VoorspanDoorsnedeInvoer): VoorspanDoorsnedeUitkomst {
  if (![i.oppervlakteMm2, i.iyMm4, i.hoogteMm].every((v) => Number.isFinite(v) && v > 0) ||
      !Number.isFinite(i.effectieveKrachtN) || i.effectieveKrachtN < 0 ||
      !Number.isFinite(i.excentriciteitMm) || !Number.isFinite(i.uitwendigMomentNmm) ||
      Math.abs(i.excentriciteitMm) >= i.hoogteMm / 2) {
    throw new Error("Ongeldige doorsnede of peeskracht voor de voorspanningscontrole.");
  }
  const pOverA = i.effectieveKrachtN / i.oppervlakteMm2;
  const w = i.iyMm4 / (i.hoogteMm / 2);
  const mNet = i.uitwendigMomentNmm - i.effectieveKrachtN * i.excentriciteitMm;
  const sigmaOnderMpa = pOverA - mNet / w;
  return {
    sigmaBovenMpa: pOverA + mNet / w,
    sigmaOnderMpa,
    decomprimerendMomentNmm: i.effectieveKrachtN * (i.excentriciteitMm + w / i.oppervlakteMm2),
    onderzijdeGedecomprimeerd: sigmaOnderMpa <= 0,
  };
}

/**
 * EN 1992-1-1:2004 §6.2, voorbeeld 6.3 uit EC2 Worked Examples.
 * v_min en k1 zijn expliciete parameters: een andere NB mag niet stil de
 * getallen uit het Italiaanse voorbeeld overnemen.
 */
export interface VoorspanDwarskrachtInvoer {
  bwMm: number;
  hMm: number;
  dMm: number;
  sigmaCpMpa: number;
  fctdMpa: number;
  vMinMpa: number;
  k1: number;
}

export function voorspanDwarskrachtZonderBeugels(i: VoorspanDwarskrachtInvoer) {
  if (![i.bwMm, i.hMm, i.dMm, i.fctdMpa, i.vMinMpa].every((v) => Number.isFinite(v) && v > 0) ||
      !Number.isFinite(i.sigmaCpMpa) || i.sigmaCpMpa < 0 ||
      !Number.isFinite(i.k1) || i.k1 < 0 || i.dMm >= i.hMm) {
    throw new Error("Ongeldige invoer voor de voorgespannen dwarskrachtcontrole.");
  }
  const iyMm4 = i.bwMm * i.hMm ** 3 / 12;
  const statischMomentMm3 = i.bwMm * i.hMm ** 2 / 8;
  const gescheurdN = (i.vMinMpa + i.k1 * i.sigmaCpMpa) * i.bwMm * i.dMm;
  const ongescheurdN = iyMm4 * i.bwMm / statischMomentMm3 *
    Math.sqrt(i.fctdMpa ** 2 + i.fctdMpa * i.sigmaCpMpa);
  return { gescheurdN, ongescheurdN, iyMm4, statischMomentMm3 };
}
