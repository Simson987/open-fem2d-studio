/** De voorlopig ondersteunde EN 1999-legering. Sterkten horen bij de toetskern. */
export interface AluminiumMateriaal {
  aanduiding: "EN AW-6063-T6";
  eMod: 70000; // N/mm², European Aluminium worked example 1
  dichtheid: 2700; // kg/m³, European Aluminium product data
}

const MATERIAAL: AluminiumMateriaal = {
  aanduiding: "EN AW-6063-T6",
  eMod: 70000,
  dichtheid: 2700,
};

/** Een expliciet prefix verhindert dat een vrije materiaalnaam als staal telt. */
export function isAluminiumMateriaal(naam: string | undefined): boolean {
  return /^\s*ALU:/i.test(naam ?? "");
}

export function parseAluminiumMateriaal(naam: string | undefined): AluminiumMateriaal | null {
  if (!isAluminiumMateriaal(naam)) return null;
  const legering = naam!.replace(/^\s*ALU:\s*/i, "").replace(/[\s-]/g, "").toUpperCase();
  return legering === "ENAW6063T6" ? MATERIAAL : null;
}
