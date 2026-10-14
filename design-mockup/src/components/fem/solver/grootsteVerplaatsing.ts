import type { ElementForces, NodalDisp } from "./types";
import { tussenStations, zakkingPunten } from "./veldExtremen";

/**
 * De grootste verplaatsing van een resultaat (mm): de lengte van de
 * verplaatsingsvector, in de knopen én langs de staven.
 *
 * WAAROM LANGS DE STAVEN. Tot issue #32 telden alleen de knopen mee. Een
 * ligger met alleen oplegknopen heeft daar u = 0; de melding boven het canvas
 * gaf dan "max |u| = 0.00 mm" terwijl de ligger 5qL⁴/(384EI) doorbuigt. De
 * stationsarrays `deflection` en `axialDisp` bevatten de volledige
 * veldverplaatsing (Hermite-deel op de eind-DOF's plus de particuliere
 * oplossing van de elementbelasting, zie `core/fem/BeamForces.ts`), in
 * LOKALE assen.
 *
 * WAAROM DE VECTORLENGTE. De vervormingsweergave (`FemResultsOverlay`) meet
 * per sample √(dx² + dz²); de lengte is ongevoelig voor de assendraaiing,
 * dus √(u² + w²) in lokale assen geeft hetzelfde getal zonder de staafstand
 * te kennen. Melding en weergave noemen zo dezelfde "max |u|". In een knoop
 * is dat √(ux² + uz²), niet meer het grootste van |ux| en |uz|.
 *
 * Een staaf zonder volledige stationsarrays draagt alleen via zijn knopen
 * bij — dezelfde voorwaarde waaronder de weergave op knoopwaarden terugvalt.
 *
 * TUSSEN DE STATIONS (controle 12 oktober 2026, punt C8). Het maximum van de
 * zakking ligt waar θ = 0, meestal tussen twee stations: een ingeklemde
 * ligger 6 m onder 10 kN/m gaf 3,986 mm op station 3600 waar het maximum
 * 3,998 mm op x = 3471 is. Daar telt nu ook het stationaire punt van de
 * Hermite-kubiek door w en θ mee (`zakkingPunten`), met de axiale
 * verplaatsing lineair ertussen.
 */
export function grootsteVerplaatsing(
  displacements: Iterable<NodalDisp>,
  elements: Iterable<ElementForces>,
): number {
  let max = 0;
  for (const d of displacements) {
    const u = Math.hypot(d.ux, d.uz);
    if (u > max) max = u;
  }
  for (const ef of elements) {
    const n = ef.stations_mm?.length ?? 0;
    if (n < 2 || ef.deflection?.length !== n || ef.axialDisp?.length !== n) continue;
    for (let k = 0; k < n; k++) {
      const u = Math.hypot(ef.axialDisp[k], ef.deflection[k]);
      if (u > max) max = u;
    }
    for (const p of zakkingPunten(ef)) {
      const u = Math.hypot(tussenStations(ef.axialDisp, p.i, p.s), p.waarde);
      if (u > max) max = u;
    }
  }
  return max;
}
