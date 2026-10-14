/**
 * stramienStreepStip.ts — het lijnpatroon van stramien- en levellijnen
 * (issue #103): streep-stip, zoals stramien- en hartlijnen op een
 * constructietekening. Een lange streep, een korte tussenruimte, een stip
 * (een heel kort streepje) en weer een korte tussenruimte.
 *
 * Eén patroon, in schermpixels, voor 2D en 3D:
 *  - 2D: `.fem-stramien-line` in FemCanvas.css (`stroke-dasharray`). CSS kan
 *    deze module niet lezen; test-stramien-streepstip.mjs houdt de twee gelijk.
 *  - 3D: openFem3dStramienLijn.ts, een eigen fragment shader met hetzelfde
 *    patroon ({@link stramienStreepStipGetekend} is daar de regel van).
 *
 * Het rapport tekent het stramien in de eenheden van zijn viewBox, met een
 * eigen streep-stip (reportGeometry.tsx, renderGridAxisLines).
 */

/** Lange streep, tussenruimte, stip, tussenruimte (px). */
export const STRAMIEN_STREEPSTIP_PX = [16, 4, 2, 4] as const;

export type StreepStipPatroon = readonly [streep: number, tussen: number, stip: number, tussenNaStip: number];

/** De lengte van één herhaling van het patroon (px). */
export function streepStipPeriode(patroon: StreepStipPatroon = STRAMIEN_STREEPSTIP_PX): number {
  return patroon[0] + patroon[1] + patroon[2] + patroon[3];
}

/**
 * Wordt een lijn op `afstandPx` van haar begin getekend? Het patroon begint
 * met de lange streep. Dezelfde regel als de fragment shader van 3D: op een
 * grens telt het punt als getekend.
 */
export function stramienStreepStipGetekend(afstandPx: number, patroon: StreepStipPatroon = STRAMIEN_STREEPSTIP_PX): boolean {
  const [streep, tussen, stip] = patroon;
  const periode = streepStipPeriode(patroon);
  const t = afstandPx - periode * Math.floor(afstandPx / periode);
  return t <= streep || (t >= streep + tussen && t <= streep + tussen + stip);
}

/** Het patroon als waarde voor `stroke-dasharray` ("16 4 2 4"). */
export function streepStipDasharray(patroon: StreepStipPatroon = STRAMIEN_STREEPSTIP_PX): string {
  return patroon.join(" ");
}
