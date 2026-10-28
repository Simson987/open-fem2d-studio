/**
 * Aluminiumlegeringen voor de 2D-staaf: herkenning van de materiaalnaam
 * (`ALU:<legering>`) en de stijfheid/dichtheid voor de solver.
 *
 * De STERKTEN (f_o, f_u, HAZ, knikklasse) staan bewust NIET hier maar in de
 * Rust-kern (`nen-en-1999-1-1`, tabel 3.2b): daar hangen ze van de plaatdikte
 * af en daar worden ze getoetst. Deze lijst moet dezelfde aanduidingen hebben
 * als `legering_namen()` in die crate — `test-aluminium-check.mjs` bewaakt dat.
 *
 * E = 70 000 N/mm², G = 27 000 N/mm², ρ = 2 700 kg/m³: NEN-EN 1999-1-1 §3.2.5.
 */
export interface AluminiumMateriaal {
  /** Aanduiding zoals de toetskern hem kent, bijv. "EN AW-6082 T6". */
  aanduiding: string;
  eMod: 70000;
  dichtheid: 2700;
}

/** De legeringen die de EN 1999-kern kent (tabel 3.2b, extrusieprofielen, T6). */
export const ALUMINIUM_LEGERINGEN = [
  "EN AW-6060 T6",
  "EN AW-6061 T6",
  "EN AW-6063 T6",
  "EN AW-6082 T6",
] as const;

/** Het voorvoegsel waarmee een materiaalnaam aluminium is. */
export const ALU_VOORVOEGSEL = "ALU:";

/** Een expliciet prefix verhindert dat een vrije materiaalnaam als staal telt. */
export function isAluminiumMateriaal(naam: string | undefined): boolean {
  return /^\s*ALU:/i.test(naam ?? "");
}

function normaliseer(s: string): string {
  return s.replace(/[\s_-]/g, "").toUpperCase();
}

/** De materiaalnaam voor een legering: "ALU:EN AW-6082 T6". */
export function aluminiumMateriaalNaam(legering: string): string {
  return `${ALU_VOORVOEGSEL}${legering}`;
}

/**
 * Lees een aluminium materiaalnaam. Spaties en koppeltekens tellen niet mee,
 * dus "ALU:EN AW-6063-T6" (de oude schrijfwijze) blijft herkend. Een onbekende
 * legering geeft `null`: dan rekent de solver NIET verder met een aangenomen
 * stijfheid.
 */
export function parseAluminiumMateriaal(naam: string | undefined): AluminiumMateriaal | null {
  if (!isAluminiumMateriaal(naam)) return null;
  const sleutel = normaliseer(naam!.replace(/^\s*ALU:\s*/i, ""));
  const legering = ALUMINIUM_LEGERINGEN.find((l) => normaliseer(l) === sleutel);
  return legering ? { aanduiding: legering, eMod: 70000, dichtheid: 2700 } : null;
}
