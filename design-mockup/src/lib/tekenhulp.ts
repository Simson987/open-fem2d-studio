/**
 * Tekenhulpen voor het 2D-tekenvlak (#53): Shift als ortho en de hoeksnap bij
 * het tekenen van een staaf.
 *
 * Zuivere rekenregels zonder React of scherm: het tekenvlak geeft het
 * beginpunt en het (gesnapte) muispunt in modelcoördinaten (mm) en tekent wat
 * hier uitkomt. Zo zijn de regels los te testen (test-tekenhulp.mjs) en is er
 * één plek waar ze staan.
 *
 * ORTHO (Shift ingedrukt)
 *   De richting vanaf het beginpunt wordt horizontaal of verticaal. De as
 *   volgt uit de grootste component van de muisverplaatsing, MET HYSTERESE:
 *   ligt er al een as vast, dan wisselt hij pas als de andere component
 *   `ORTHO_WISSEL_FACTOR` keer zo groot is én het verschil minstens
 *   `minVerschil` is. Zonder die drempel springt de as heen en weer zodra de
 *   muis ongeveer diagonaal staat.
 *
 * HOEKSNAP (zonder Shift, alleen bij het tekenen van een staaf)
 *   Ligt de richting binnen de tolerantie van 0° of 90° (desgewenst ook 30°,
 *   45° en 60°), en hun spiegelingen, dan wordt het eindpunt op die hoek
 *   gedraaid met behoud van lengte. De hoeken 0°, 90°, 180° en 270° komen
 *   exact uit: de andere coördinaat is dan precies die van het beginpunt.
 *   Een punt dat al op de hoek ligt, blijft ongewijzigd.
 */

export type OrthoAs = "x" | "z";

export interface Punt2 {
  x: number;
  z: number;
}

/** Zoveel keer groter moet de andere component zijn voordat de ortho-as wisselt. */
export const ORTHO_WISSEL_FACTOR = 1.25;
/** Minimaal verschil in schermpixels voor een wissel van de ortho-as. */
export const ORTHO_WISSEL_MIN_PX = 6;

/** Hoeksnap: standaardtolerantie en grenzen, in graden. */
export const HOEKSNAP_STANDAARD_TOLERANTIE = 2;
export const HOEKSNAP_MIN_TOLERANTIE = 0.1;
export const HOEKSNAP_MAX_TOLERANTIE = 15;

const BASIS_HOEKEN = [0, 90] as const;
const EXTRA_HOEKEN = [0, 30, 45, 60, 90] as const;

/**
 * Zo dicht bij een schuine hoek (in graden, ≈ 2·10⁻⁹ rad) ligt een punt "al
 * op die hoek": opnieuw draaien gaf dan alleen afrondingsruis, (1000, 1000)
 * werd (1000,0000000000001, 1000).
 */
const OP_HOEK_GRADEN = 1e-7;
/** Afronding van een berekend punt (mm): een miljoenste millimeter. */
const AFRONDING_MM = 1e6;
const rondAf = (v: number) => Math.round(v * AFRONDING_MM) / AFRONDING_MM;

/**
 * De ortho-as bij deze muisstand. Zonder vorige as wint de grootste component
 * (gelijk: horizontaal). Met een vorige as wisselt hij alleen als de andere
 * component duidelijk groter is.
 */
export function orthoAs(
  start: Punt2, cursor: Punt2, vorigeAs: OrthoAs | null, minVerschil = 0,
): OrthoAs {
  const ax = Math.abs(cursor.x - start.x);
  const az = Math.abs(cursor.z - start.z);
  if (!Number.isFinite(ax) || !Number.isFinite(az)) return vorigeAs ?? "x";
  if (vorigeAs === null) return ax >= az ? "x" : "z";
  const huidig = vorigeAs === "x" ? ax : az;
  const ander = vorigeAs === "x" ? az : ax;
  const wissel = ander > ORTHO_WISSEL_FACTOR * huidig && ander - huidig >= minVerschil;
  if (!wissel) return vorigeAs;
  return vorigeAs === "x" ? "z" : "x";
}

/**
 * Het ortho-punt: de muis teruggebracht op de horizontale of verticale lijn
 * door het beginpunt. `minVerschil` is in modelmaat (mm) — het tekenvlak
 * rekent `ORTHO_WISSEL_MIN_PX` om met de zoomschaal.
 */
export function orthoPunt(
  start: Punt2, cursor: Punt2, vorigeAs: OrthoAs | null, minVerschil = 0,
): { punt: Punt2; as: OrthoAs } {
  const as = orthoAs(start, cursor, vorigeAs, minVerschil);
  return {
    punt: as === "x" ? { x: cursor.x, z: start.z } : { x: start.x, z: cursor.z },
    as,
  };
}

/** De hoeken waarop de hoeksnap vangt (eerste kwadrant; spiegelingen volgen vanzelf). */
export function hoekSnapHoeken(extra: boolean): number[] {
  return [...(extra ? EXTRA_HOEKEN : BASIS_HOEKEN)];
}

/** Richting in graden, genormaliseerd op [0, 360). */
function normaliseer(graden: number): number {
  const r = ((graden % 360) + 360) % 360;
  return r === 360 ? 0 : r;
}

/** Elke basishoek met zijn spiegelingen in de vier kwadranten. */
function kandidaten(hoeken: readonly number[]): number[] {
  const set = new Set<number>();
  for (const a of hoeken) {
    if (!Number.isFinite(a)) continue;
    for (const k of [a, 180 - a, 180 + a, 360 - a]) set.add(normaliseer(k));
  }
  return [...set];
}

/** cos en sin van een hoek in graden, exact op de assen. */
function richtingVector(graden: number): { c: number; s: number } {
  switch (graden) {
    case 0: return { c: 1, s: 0 };
    case 90: return { c: 0, s: 1 };
    case 180: return { c: -1, s: 0 };
    case 270: return { c: 0, s: -1 };
    default: {
      const r = graden * Math.PI / 180;
      return { c: Math.cos(r), s: Math.sin(r) };
    }
  }
}

/**
 * Hoeksnap: draai `punt` om `start` naar de dichtstbijzijnde hoek binnen de
 * tolerantie, met behoud van lengte. Null als er niets te vangen is (buiten
 * de tolerantie, lengte nul, ongeldige invoer). `hoekGraden` is de richting
 * van de staaf op [0, 360): 0 = naar rechts, 90 = omhoog, 180 = naar links.
 * Ligt `punt` al op de gevangen hoek, dan komt het ongewijzigd terug.
 */
export function hoekSnap(
  start: Punt2, punt: Punt2, tolerantieGraden: number, hoeken: readonly number[],
): { punt: Punt2; hoekGraden: number } | null {
  const dx = punt.x - start.x;
  const dz = punt.z - start.z;
  const lengte = Math.hypot(dx, dz);
  if (!Number.isFinite(lengte) || lengte < 1e-9) return null;
  if (!(tolerantieGraden > 0)) return null;
  const richting = normaliseer(Math.atan2(dz, dx) * 180 / Math.PI);
  let beste: { hoek: number; verschil: number } | null = null;
  for (const k of kandidaten(hoeken)) {
    const verschil = Math.abs(((richting - k + 540) % 360) - 180);
    if (verschil <= tolerantieGraden + 1e-12 && (beste === null || verschil < beste.verschil)) {
      beste = { hoek: k, verschil };
    }
  }
  if (!beste) return null;
  const { c, s } = richtingVector(beste.hoek);
  // Al op de hoek: langs een as is de andere component exact nul, schuin
  // ligt de richting binnen OP_HOEK_GRADEN.
  const alOpHoek = c === 0 ? dx === 0 : s === 0 ? dz === 0 : beste.verschil < OP_HOEK_GRADEN;
  if (alOpHoek) return { punt: { x: punt.x, z: punt.z }, hoekGraden: beste.hoek };
  return {
    punt: {
      x: c === 0 ? start.x : start.x + lengte * c,
      z: s === 0 ? start.z : start.z + lengte * s,
    },
    hoekGraden: beste.hoek,
  };
}

/**
 * Het rasterpunt op de straal vanaf `start` in richting (c, s) dat het
 * dichtst bij afstand `t0` ligt, binnen één rasterstap. Null als er daar geen
 * rasterpunt exact op de straal ligt: bij 30° en 60° nooit (tan 30° is
 * irrationaal), bij 45° alleen als het beginpunt "in de pas" van het raster
 * loopt (|dx| = |dz| = een veelvoud van de rasterstap).
 */
function rasterPuntOpStraal(
  start: Punt2, c: number, s: number, t0: number, rasterStap: number,
): Punt2 | null {
  const rond = (v: number) => Math.round(v / rasterStap) * rasterStap;
  let beste: { t: number; p: Punt2 } | null = null;
  const probeer = (t: number) => {
    if (!(t > 1e-9) || !Number.isFinite(t)) return;
    const x = start.x + t * c, z = start.z + t * s;
    const xr = rond(x), zr = rond(z);
    if (Math.abs(x - xr) > 1e-6 || Math.abs(z - zr) > 1e-6) return;
    if (beste === null || Math.abs(t - t0) < Math.abs(beste.t - t0)) beste = { t, p: { x: xr, z: zr } };
  };
  // Kandidaten: de rasterlijnen bij het gedraaide punt (en hun buren), in x
  // en in z, teruggerekend naar de afstand langs de straal.
  for (const k of [-1, 0, 1]) {
    if (Math.abs(c) > 1e-12) probeer((rond(start.x + t0 * c) + k * rasterStap - start.x) / c);
    if (Math.abs(s) > 1e-12) probeer((rond(start.z + t0 * s) + k * rasterStap - start.z) / s);
  }
  const b = beste as { t: number; p: Punt2 } | null;
  return b !== null && Math.abs(b.t - t0) <= rasterStap ? b.p : null;
}

/**
 * Een hoeksnappunt terug op het raster, als het raster aan staat. De hoeksnap
 * draait het rasterpunt (behoud van lengte) en komt daardoor naast het raster
 * uit: (5000, 100) wordt (5001, 0). Daarom:
 *   - is het punt al een rasterpunt (het lag al op de hoek, bv. (3000, 3000)
 *     bij 45°), dan blijft het;
 *   - langs een as (0°, 90°, 180°, 270°): de coördinaat langs de as op het
 *     raster, de andere die van het beginpunt — net als bij ortho;
 *   - schuin: het dichtstbijzijnde rasterpunt dat exact op de straal ligt
 *     (bij 45° vanaf een rasterpunt: |dx| = |dz| = een veelvoud van de
 *     rasterstap);
 *   - schuin zonder rasterpunt op de straal (30°, 60°, of een beginpunt naast
 *     het raster): de lengte afgerond op een veelvoud van de rasterstap, het
 *     punt afgerond op een miljoenste millimeter (geen 2999,9999999999995).
 * Zou het punt daarmee op het beginpunt vallen, dan blijft het gedraaide punt.
 * Zonder geldige rasterstap: het gedraaide punt ongewijzigd.
 */
export function hoekPuntOpRaster(
  start: Punt2, snap: { punt: Punt2; hoekGraden: number }, rasterStap: number,
): Punt2 {
  if (!(rasterStap > 0) || !Number.isFinite(rasterStap)) return snap.punt;
  const rond = (v: number) => Math.round(v / rasterStap) * rasterStap;
  if (rond(snap.punt.x) === snap.punt.x && rond(snap.punt.z) === snap.punt.z) return snap.punt;
  let p: Punt2;
  if (snap.hoekGraden % 180 === 0) {
    p = { x: rond(snap.punt.x), z: start.z };
  } else if (snap.hoekGraden % 90 === 0) {
    p = { x: start.x, z: rond(snap.punt.z) };
  } else {
    const lengte = Math.hypot(snap.punt.x - start.x, snap.punt.z - start.z);
    const { c, s } = richtingVector(snap.hoekGraden);
    const opStraal = rasterPuntOpStraal(start, c, s, lengte, rasterStap);
    if (opStraal) {
      p = opStraal;
    } else {
      const l = rond(lengte);
      p = { x: rondAf(start.x + l * c), z: rondAf(start.z + l * s) };
    }
  }
  if (Math.hypot(p.x - start.x, p.z - start.z) < 1e-9) return snap.punt;
  return p;
}

/** Tolerantie binnen de grenzen; geen getal → de standaard. */
export function begrensHoekTolerantie(graden: number): number {
  if (!Number.isFinite(graden)) return HOEKSNAP_STANDAARD_TOLERANTIE;
  return Math.min(HOEKSNAP_MAX_TOLERANTIE, Math.max(HOEKSNAP_MIN_TOLERANTIE, graden));
}

/**
 * Een getypte tolerantie: komma of punt, een graadteken en spaties mogen.
 * Null voor geen getal, nul of negatief; anders begrensd op 0,1–15.
 */
export function leesHoekTolerantie(tekst: string): number | null {
  const schoon = tekst.replace(/\s+/g, "").replace(/°$/, "");
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(schoon)) return null;
  const waarde = Number(schoon.replace(",", "."));
  if (!Number.isFinite(waarde) || waarde <= 0) return null;
  return begrensHoekTolerantie(waarde);
}
