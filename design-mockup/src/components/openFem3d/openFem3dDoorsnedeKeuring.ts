/**
 * Keuring van profiel en materiaal van een 3D-staaf (#230).
 *
 * Een staaf met een profiel of materiaal dat de rekenkern niet kent, of een
 * combinatie die niet bij elkaar past ("IPE 9999", "S999", "IPE 300" in C24),
 * weigert Berekenen met de reden van `resolveSection` (`bron === "default"`).
 * Dezelfde regel wordt hier vroeg toegepast: bij `model3d.beam.add/update`
 * (weigeren), bij `gui_build_3d_model` (weigeren), bij `model3d.get` en bij het
 * openen van een project (melden), zodat zo'n staaf niet ongemerkt in een
 * model staat tot iemand op Berekenen drukt.
 *
 * Een eigen doorsnede ("EIGEN:…") wordt hier NIET gekeurd: die staat in de
 * winkel van de app (profieleditor), die het API-kanaal zonder app niet ziet.
 * Berekenen weigert een niet bewaarde eigen doorsnede nog altijd met reden.
 */
import { CONCRETE_E_CM, resolveSection, TIMBER_E_MEAN } from "../../lib/sectionResolver";
import { STEEL_GRADES } from "../../lib/steelGrades";
import { STEEL_SECTIONS } from "../../lib/steelSections.generated";
import { isEigenProfiel } from "../../lib/profieleditor/eigenDoorsnedenStore";

export interface OnbekendeStaafdoorsnede {
  beamId: number;
  profileName: string | null;
  material: string | null;
  /** De reden van `resolveSection`, zoals Berekenen haar geeft. */
  reden: string;
  /** Bekende namen als suggestie (met spatie vooraan), of "". */
  suggestie: string;
}

/**
 * Bekende catalogusnamen die op een onbekende staalprofielnaam lijken: dezelfde
 * reeks (letters vooraan), het dichtst bij het getal. Alleen een suggestie.
 */
function lijkendeProfielen(profiel: string): string[] {
  const sleutel = profiel.replace(/[\s\-.]/g, "").toUpperCase();
  const m = /^([A-Z]+)(\d+)?/.exec(sleutel);
  if (!m) return [];
  const [, reeks, getal] = m;
  const doel = getal ? Number(getal) : 0;
  return Object.keys(STEEL_SECTIONS)
    .filter((k) => k.startsWith(reeks) && /^\d/.test(k.slice(reeks.length)))
    .map((k) => ({ k, n: Number(/^\d+/.exec(k.slice(reeks.length))![0]) }))
    .sort((a, b) => Math.abs(a.n - doel) - Math.abs(b.n - doel) || a.k.localeCompare(b.k))
    .slice(0, 5)
    .map((x) => x.k);
}

/** De keuring van één staaf: `null` als Berekenen haar doorsnede kent. */
export function keurOpenFem3DStaafdoorsnede(
  beam: { id: number; material?: string; profileName?: string },
): OnbekendeStaafdoorsnede | null {
  const materiaal = beam.material?.trim() ?? "";
  const profiel = beam.profileName?.trim() ?? "";
  if (isEigenProfiel(profiel)) return null;
  const r = resolveSection(materiaal, profiel);
  if (r.bron !== "default") return null;
  const materiaalBekend = STEEL_GRADES.includes(materiaal) || materiaal in TIMBER_E_MEAN
    || materiaal in CONCRETE_E_CM || /^(VRIJ|ALU)/i.test(materiaal);
  const suggestie = !materiaalBekend
    ? ` Bekende materialen: ${[...STEEL_GRADES].join(", ")}; hout ${Object.keys(TIMBER_E_MEAN).slice(0, 4).join(", ")} …; ` +
      `beton ${Object.keys(CONCRETE_E_CM).slice(0, 3).join(", ")} …; of vrij materiaal "VRIJ:<naam> E=<N/mm2> rho=<kg/m3> f=<N/mm2>".`
    : STEEL_GRADES.includes(materiaal) && lijkendeProfielen(profiel).length > 0
      ? ` Bekende profielen in deze reeks: ${lijkendeProfielen(profiel).join(", ")}.`
      : "";
  return {
    beamId: beam.id,
    profileName: profiel || null,
    material: materiaal || null,
    reden: r.reden ?? "doorsnede onbekend",
    suggestie,
  };
}

/** Alle staven van een model met een onbekend profiel of materiaal, oplopend. */
export function onbekendeOpenFem3DDoorsneden(
  model: { beams: readonly { id: number; material?: string; profileName?: string }[] },
): OnbekendeStaafdoorsnede[] {
  return model.beams
    .map(keurOpenFem3DStaafdoorsnede)
    .filter((x): x is OnbekendeStaafdoorsnede => x !== null)
    .sort((a, b) => a.beamId - b.beamId);
}

/** Eén regel per staaf: "3D-staaf 1: <reden>". */
export function beschrijfOnbekendeDoorsnede(x: OnbekendeStaafdoorsnede): string {
  return `3D-staaf ${x.beamId}: ${x.reden}`;
}
