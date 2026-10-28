/**
 * openFem3dSymbolScale.ts — de grootte van knopen en opleggingen in 3D
 * (issue #82). De knoopbol en de opleggingssymbolen hebben een automatische
 * maat uit de modelgrootte; twee regelaars (Knopen, Opleggingen) vergroten of
 * verkleinen die van 25 tot 400 %, standaard 100 %. Een weergavevoorkeur
 * (bewaard met de zichtbaarheid en in een opgeslagen view), geen modelgegeven.
 * Geen React, geen Three.
 *
 * Getekende maat = automatische maat × procent / 100; 100 % is precies de
 * tekening van vóór de regelaars. Een waarde die geen eindig getal is (een
 * oude opslag of view zonder veld, of iets ongeldigs) geldt als 100 %; een
 * getal buiten het bereik wordt begrensd en op hele procenten afgerond.
 *
 * De regelaar loopt in standen (OPEN_FEM_3D_SYMBOL_PERCENT_STOPS): ongeveer
 * gelijke stappen op een logaritmische schaal, met 100 % precies in het midden,
 * zodat die stand altijd exact te kiezen is.
 */

export const OPEN_FEM_3D_SYMBOL_PERCENT_MIN = 25;
export const OPEN_FEM_3D_SYMBOL_PERCENT_MAX = 400;
export const OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT = 100;

/** De standen van de regelaar, in %: negen kleiner dan 100 %, negen groter. */
export const OPEN_FEM_3D_SYMBOL_PERCENT_STOPS: readonly number[] = [
  25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 350, 400,
];

/** Elke waarde → een geldig percentage: geen eindig getal → 100 %, anders afgerond en begrensd tot 25–400 %. */
export function normalizeOpenFem3DSymbolPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT;
  return Math.min(OPEN_FEM_3D_SYMBOL_PERCENT_MAX, Math.max(OPEN_FEM_3D_SYMBOL_PERCENT_MIN, Math.round(value)));
}

/** De schaalfactor van een percentage (100 % → 1). */
export function openFem3DSymbolScaleFactor(percent: unknown): number {
  return normalizeOpenFem3DSymbolPercent(percent) / 100;
}

/** De getekende maat: automatische maat × schaal. */
export function openFem3DScaledSymbolSize(autoSize: number, percent: unknown): number {
  const factor = openFem3DSymbolScaleFactor(percent);
  return factor === 1 ? autoSize : autoSize * factor;
}

/** De positie van de regelaar voor een percentage: de dichtstbijzijnde stand (logaritmisch). */
export function openFem3DSymbolSliderFromPercent(percent: unknown): number {
  const p = normalizeOpenFem3DSymbolPercent(percent);
  let best = 0;
  OPEN_FEM_3D_SYMBOL_PERCENT_STOPS.forEach((stop, index) => {
    if (Math.abs(Math.log(stop / p)) < Math.abs(Math.log(OPEN_FEM_3D_SYMBOL_PERCENT_STOPS[best] / p))) best = index;
  });
  return best;
}

/** Het percentage bij een positie van de regelaar; daarbuiten de eerste of laatste stand. */
export function openFem3DSymbolPercentFromSlider(index: number): number {
  if (!Number.isFinite(index)) return OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT;
  const last = OPEN_FEM_3D_SYMBOL_PERCENT_STOPS.length - 1;
  return OPEN_FEM_3D_SYMBOL_PERCENT_STOPS[Math.min(last, Math.max(0, Math.round(index)))];
}
