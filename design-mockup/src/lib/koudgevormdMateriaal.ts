/**
 * Staalsoorten voor koudgevormde profielen (NEN-EN 1993-1-3, issue #4):
 * herkenning van de materiaalnaam (`KV:<staalsoort>`) en de stijfheid en
 * dichtheid voor de solver.
 *
 * De STERKTEN (f_yb, f_u) staan bewust NIET hier maar in de Rust-kern
 * (`nen-en-1993-1-3`, tabel 3.1a). Deze lijst moet dezelfde aanduidingen hebben
 * als `staalsoort_namen()` in die crate — `test-koudgevormd-check.mjs`
 * bewaakt dat.
 *
 * Een eigen voorvoegsel (en geen kale "S350GD"): zo komt een koudgevormde
 * staaf nooit stil in de toets voor warmgewalst staal (EN 1993-1-1) terecht.
 *
 * E = 210 000 N/mm² (§3.2.6), ρ = 7 850 kg/m³ (EN 1991-1-1 tabel A.4).
 */
export interface KoudgevormdMateriaal {
  /** Aanduiding zoals de toetskern hem kent, bijv. "S350GD". */
  aanduiding: string;
  eMod: 210000;
  dichtheid: 7850;
}

/** De staalsoorten die de EN 1993-1-3-kern kent (tabel 3.1a, deelverzameling). */
export const KOUDGEVORMD_STAALSOORTEN = [
  "S235",
  "S275",
  "S355",
  "S220GD",
  "S250GD",
  "S280GD",
  "S320GD",
  "S350GD",
] as const;

/** Het voorvoegsel waarmee een materiaalnaam koudgevormd staal is. */
export const KV_VOORVOEGSEL = "KV:";

export function isKoudgevormdMateriaal(naam: string | undefined): boolean {
  return /^\s*KV:/i.test(naam ?? "");
}

/** De materiaalnaam voor een staalsoort: "KV:S350GD". */
export function koudgevormdMateriaalNaam(staalsoort: string): string {
  return `${KV_VOORVOEGSEL}${staalsoort}`;
}

/**
 * Lees een materiaalnaam voor koudgevormd staal. Een deklaag ("+Z", "+ZA")
 * telt niet mee. Een onbekende soort geeft `null`: dan rekent de solver NIET
 * verder met een aangenomen stijfheid.
 */
export function parseKoudgevormdMateriaal(naam: string | undefined): KoudgevormdMateriaal | null {
  if (!isKoudgevormdMateriaal(naam)) return null;
  const kern = naam!.replace(/^\s*KV:\s*/i, "").split("+")[0].replace(/[\s_-]/g, "").toUpperCase();
  const soort = KOUDGEVORMD_STAALSOORTEN.find((s) => s === kern);
  return soort ? { aanduiding: soort, eMod: 210000, dichtheid: 7850 } : null;
}
