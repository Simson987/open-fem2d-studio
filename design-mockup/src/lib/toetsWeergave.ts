/**
 * toetsWeergave.ts — de toetskrachten als diagram op het tekenvlak (issue #199,
 * fase 6).
 *
 * De resultaten op het scherm volgen de instellingen Analyse en Scheefstand;
 * de UGT-toets rekent altijd zelf tweede orde (P-Δ) met scheefstand (deel 1).
 * Daardoor stond een maatgevende toets vaak op krachten die nergens te zien
 * waren: "Toon op tekenvlak" gaf dan alleen een melding (besluit B4). Fase 6
 * laat het tekenvlak naar de TOETSSET overschakelen: dezelfde combinaties en
 * krachten waarop de laatste toetsronde rekende (`CheckRunData`), met de
 * UGT-toetsvarianten (+x en −x, id + 1 000 000) en de BGT uit de resultaten.
 *
 * Puur: geen React. De app bewaart alleen het gekozen combinatie-id; deze
 * functies zeggen of dat id in de toetsset bestaat en welke set het tekenvlak
 * dan krijgt.
 */
import type { LoadCombination } from "../components/fem/solver/combinations";
import type { SolverResult } from "../components/fem/solver/types";

/** Wat het tekenvlak nodig heeft om de toetsset te tonen. */
export interface ToetsSetVoorWeergave {
  combinations: readonly LoadCombination[];
  combinationResults: ReadonlyMap<number, SolverResult>;
}

/**
 * De combinatie die het tekenvlak in de toetsweergave toont, of `null` als er
 * niets te tonen is (geen toetsronde, of het id zit er niet in).
 *
 *  - `gevraagd` in de toetsset met krachten: dat id;
 *  - anders, als `terugval` aan staat: de eerste UGT-toetscombinatie met
 *    krachten (bijvoorbeeld als de gebruiker de weergave aanzet terwijl de
 *    resultaten een eerste-ordecombinatie tonen die in de toets twee varianten
 *    heeft);
 *  - anders `null`.
 */
export function kiesToetsCombinatie(
  set: ToetsSetVoorWeergave | null | undefined,
  gevraagd: number | null | undefined,
  terugval = false,
): number | null {
  if (!set) return null;
  if (gevraagd !== null && gevraagd !== undefined && set.combinationResults.has(gevraagd)
    && set.combinations.some((c) => c.id === gevraagd)) return gevraagd;
  if (!terugval) return null;
  const eerste = set.combinations.find((c) => c.type === "uls" && set.combinationResults.has(c.id));
  return eerste?.id ?? null;
}

/**
 * Of de resultaten op het scherm voor combinatie `id` precies de toetskrachten
 * zijn (hetzelfde object): dan kan het tekenvlak gewoon de resultaten tonen en
 * is de toetsweergave niet nodig.
 */
export function resultatenZijnToetskrachten(
  set: ToetsSetVoorWeergave | null | undefined,
  resultaten: ReadonlyMap<number, SolverResult> | null | undefined,
  id: number,
): boolean {
  const r = resultaten?.get(id);
  return r !== undefined && set?.combinationResults.get(id) === r;
}
