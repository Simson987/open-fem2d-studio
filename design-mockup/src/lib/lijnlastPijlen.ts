/**
 * Pijlen van een lijnlast op het tekenvlak: een vaste h.o.h.-afstand, zodat een
 * korte staaf niet volloopt met pijlen en op een lange staaf geen gaten vallen.
 * Er staat altijd een pijl op beide uiteinden van het belaste deel; de
 * onderlinge afstand ligt daardoor tussen een halve en anderhalve keer `hohPx`.
 * Alleen een deel korter dan een halve h.o.h. houdt zijn twee eindpijlen dichter
 * bij elkaar.
 *
 * Het tekenvlak meet de lengte bij passend beeld, niet bij de huidige zoom: in-
 * en uitzoomen verandert het aantal pijlen dan niet (#101).
 */
export const LIJNLAST_PIJL_HOH_PX = 24;

/** Aantal intervallen tussen de pijlen (aantal pijlen = intervallen + 1). */
export function lijnlastPijlIntervallen(segmentPx: number, hohPx: number = LIJNLAST_PIJL_HOH_PX): number {
  if (!Number.isFinite(segmentPx) || segmentPx <= 0 || !(hohPx > 0)) return 1;
  return Math.max(1, Math.round(segmentPx / hohPx));
}

/**
 * De schaal (px per modeleenheid) van passend beeld: alle knopen met `marge`
 * rondom in het bruikbare deel van het tekenvlak, binnen de zoomgrenzen. Null
 * zonder knopen of zonder ruimte.
 */
export function passendBeeldSchaal(
  knopen: readonly { x: number; z: number }[],
  bruikbaar: { w: number; h: number },
  grenzen: { min: number; max: number },
  marge = 0.1,
): number | null {
  if (knopen.length === 0 || !(bruikbaar.w > 0) || !(bruikbaar.h > 0)) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const knoop of knopen) {
    minX = Math.min(minX, knoop.x); maxX = Math.max(maxX, knoop.x);
    minZ = Math.min(minZ, knoop.z); maxZ = Math.max(maxZ, knoop.z);
  }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxZ - minZ);
  const schaal = Math.min((bruikbaar.w * (1 - 2 * marge)) / w, (bruikbaar.h * (1 - 2 * marge)) / h);
  return Math.max(grenzen.min, Math.min(grenzen.max, schaal));
}
