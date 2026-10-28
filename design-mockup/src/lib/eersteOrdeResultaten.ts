/**
 * eersteOrdeResultaten.ts — de eerste-orde-oplossing per combinatie voor de
 * betonkolomtoets na een tweede-orde- of fysisch niet-lineaire rekengang.
 *
 * WAAROM (issue #35). EN 1992-1-1 §5.8.3.1(1) definieert r_m = M₀₁/M₀₂ met de
 * EERSTE-ORDE-eindmomenten, en 5.8.4(2) (5.19) φ_ef = φ(∞,t₀)·M₀Eqp/M₀Ed met
 * eerste-orde-momenten. Na een P-Δ- of fysisch niet-lineaire berekening zitten
 * in `combinationResults` de tweede-orde-momenten; die verschuiven C, A en
 * daarmee λ_lim. De kolomtoets krijgt daarom naast die resultaten deze
 * eerste-orde-oplossing mee (`BetonBuildData.eersteOrdeResultaten`).
 *
 * GEEN DUBBEL REKENWERK. De oplossing komt uit `eersteOrdeCombinatieResultaat`,
 * dat per rekengang memoiseert. De (5.19)-stap van de fysisch niet-lineaire lus
 * (issue #24, App.tsx) vult dezelfde cache, dus wat daar al is opgelost wordt
 * hier alleen gelezen.
 *
 * DE TOETS (issue #199). De UGT-toets rekent altijd tweede orde met
 * scheefstand, ook als de resultaten eerste orde zijn. Voor de toetsset geldt
 * daarom `eersteOrdeResultatenVoorToets`: de UGT uit de toetsrekengang, de
 * quasi-blijvende combinaties uit de resultaten.
 */
import type { Beam } from "../components/fem/femTypes";
import type { SolverResult } from "../components/fem/solver/types";
import type { LoadCombination } from "../components/fem/solver/combinations";
import { combinatiesVanSoort, zonderBgtEindtoestand } from "../components/fem/solver/combinations";
import {
  eersteOrdeCombinatieResultaat,
  getSecondOrderState,
} from "../components/fem/solver/engine";

/**
 * De eerste-orde-oplossing van de UGT-combinaties en de quasi-blijvende
 * combinaties (6.16b), gesleuteld op combinatie-id.
 *
 * `undefined` wanneer er niets te doen is: de rekengang was eerste orde (dan
 * zijn de combinatieresultaten zelf eerste orde en blijft de toetsinvoer bit
 * voor bit gelijk), of er is geen betonstaaf met een §5.8-blok — alleen de
 * kolomtoets leest deze momenten, en zonder kolom wordt er niets extra
 * gerekend. Een combinatie zonder werkzame last ontbreekt in de Map.
 */
export function eersteOrdeResultatenVoorKolomtoets(
  perCase: Map<number, SolverResult> | null | undefined,
  combinations: readonly LoadCombination[],
  beams: readonly Beam[],
): Map<number, SolverResult> | undefined {
  if (!perCase || !getSecondOrderState(perCase)) return undefined;
  const metKolom = beams.some((b) => b.checkConfig?.betonKorf && b.checkConfig?.betonKolom);
  if (!metKolom) return undefined;
  const nodig = [
    ...combinations.filter((c) => c.type === "uls"),
    ...combinatiesVanSoort(
      zonderBgtEindtoestand(combinations.filter((c) => c.type === "sls")),
      "6.16b",
    ),
  ];
  const uit = new Map<number, SolverResult>();
  for (const combo of nodig) {
    // Een eindtoestandvariant hoort bij een eerste-orde-berekening van hout
    // (EN 1995-1-1 2.2.2(1)P) en komt in een tweede-orde-rekengang niet voor.
    if (combo.eindtoestand !== undefined) continue;
    const r = eersteOrdeCombinatieResultaat(perCase, combo);
    if (r) uit.set(combo.id, r);
  }
  return uit;
}

/**
 * De eerste-orde-oplossing voor de betonkolomtoets in de TOETSSET (issue
 * #199): de UGT uit de toetsrekengang, de quasi-blijvende combinaties uit de
 * resultaten.
 *
 * WAAROM TWEE BRONNEN. De UGT-toets rekent altijd tweede orde met scheefstand
 * (`lib/toetsKrachten.ts`), los van de analyse-instelling. M₀Ed, M₀₁ en M₀₂
 * van §5.8 horen bij DIE combinaties, en hun scheefstandvarianten
 * (id + 1 000 000) bestaan alleen in de toetsset. Daarom gaat de eerste orde
 * van de UGT altijd mee, ook als de resultaten eerste orde zijn. M₀Eqp van
 * (5.19) hoort bij de quasi-blijvende BGT-combinatie (6.16b), en de BGT komt
 * uit de resultaten (NEN-EN 1992-1-1 5.2(2)P: de imperfecties horen bij de
 * UGT): na een tweede-orde-resultaatrekengang de eerste orde daarvan, na een
 * eerste-orde-rekengang de resultaten zelf. Dat is dezelfde M₀Eqp als vóór
 * #199.
 *
 * `undefined` zonder betonstaaf met een §5.8-blok: alleen de kolomtoets leest
 * deze momenten, en dan wordt er niets extra gerekend. Een combinatie zonder
 * werkzame last ontbreekt in de Map.
 */
export function eersteOrdeResultatenVoorToets(
  toets: {
    /** De perCase-Map van de toetsrekengang (met tweede-orde-status). */
    perCase: Map<number, SolverResult>;
    /** De UGT-toetscombinaties, ontvouwd in ±x. */
    ugtCombinaties: readonly LoadCombination[];
  },
  resultaten: {
    /** De perCase-Map van de resultaatrekengang; zonder tweede-orde-status = eerste orde. */
    perCase: Map<number, SolverResult> | null | undefined;
    combinationResults: Map<number, SolverResult>;
    /** De combinaties van de resultaatrekengang; hieruit de quasi-blijvende. */
    combinaties: readonly LoadCombination[];
  },
  beams: readonly Beam[],
): Map<number, SolverResult> | undefined {
  const metKolom = beams.some((b) => b.checkConfig?.betonKorf && b.checkConfig?.betonKolom);
  if (!metKolom) return undefined;
  const uit = new Map<number, SolverResult>();
  for (const combo of toets.ugtCombinaties) {
    if (combo.eindtoestand !== undefined) continue;
    const r = eersteOrdeCombinatieResultaat(toets.perCase, combo);
    if (r) uit.set(combo.id, r);
  }
  const tweedeOrde = resultaten.perCase && getSecondOrderState(resultaten.perCase) ? resultaten.perCase : null;
  const quasiBlijvend = combinatiesVanSoort(
    zonderBgtEindtoestand(resultaten.combinaties.filter((c) => c.type === "sls")),
    "6.16b",
  );
  for (const combo of quasiBlijvend) {
    const r = tweedeOrde ? eersteOrdeCombinatieResultaat(tweedeOrde, combo) : resultaten.combinationResults.get(combo.id);
    if (r) uit.set(combo.id, r);
  }
  return uit;
}
