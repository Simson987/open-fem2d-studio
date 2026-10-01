/**
 * Pijlen van een lijnlast op het tekenvlak: een vaste h.o.h.-afstand op het
 * scherm, zodat een korte staaf niet volloopt met pijlen en op een lange staaf
 * geen gaten vallen. Er staat altijd een pijl op beide uiteinden van het
 * belaste deel; de onderlinge afstand ligt daardoor tussen een halve en
 * anderhalve keer `hohPx`. Alleen een deel korter dan een halve h.o.h. houdt
 * zijn twee eindpijlen dichter bij elkaar.
 */
export const LIJNLAST_PIJL_HOH_PX = 24;

/** Aantal intervallen tussen de pijlen (aantal pijlen = intervallen + 1). */
export function lijnlastPijlIntervallen(segmentPx: number, hohPx: number = LIJNLAST_PIJL_HOH_PX): number {
  if (!Number.isFinite(segmentPx) || segmentPx <= 0 || !(hohPx > 0)) return 1;
  return Math.max(1, Math.round(segmentPx / hohPx));
}
