import {
  DEFAULT_N_STRIPS,
  DEFAULT_REINFORCEMENT_GRADE,
  matchSupportedConcreteClass,
  parseConcreteSection,
} from "../../lib/betonCheckBuilder";
import type { ConcreteBeamCheckInput } from "../../lib/types/concrete/ConcreteBeamCheckInput";
import type { ConcreteBeamCheckResult } from "../../lib/types/concrete/ConcreteBeamCheckResult";
import { roepKern } from "../../stores/checkStore";
import { combinatiesVanSoort, SCHEEFSTAND_COMBO_OFFSET } from "../fem/solver/combinations";
import type { ForcePoint } from "../../lib/types/steel/ForcePoint";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import { GEEN_UGT_TOETSCOMBINATIE, type OpenFem3DCheckSkip, type OpenFem3DCombinationSet } from "./openFem3dSteelCheck";
import { openFem3DForceStations } from "./openFem3dForceStations";
import { toetsKrachtenNotitie3D } from "./openFem3dToetsKrachten";

/**
 * De eerste orde om z voor §5.8, zonder de globale scheefstand.
 *
 * De betonkern telt om z zelf de imperfectie (N·e_i, §5.2) en de tweede orde
 * (N·e₂) op bij het eerste-ordemoment M_z. De eerste orde van de toets (B11)
 * rekent elke UGT-combinatie in +X, −X, +Y en −Y met scheefstand: daarin zit
 * de globale imperfectie om z al. Zonder deze stap telt zij dubbel.
 *
 * Eerste orde is lineair, en de varianten van een richtingpaar verschillen
 * alleen in het teken van de scheefstandlasten. Het gemiddelde van +X en −X
 * (en van +Y en −Y) is dus precies het moment van de lasten zonder
 * scheefstand, voor elke stand van de staaf. Daarom krijgt elk punt als M_z het
 * gemiddelde over de volledige richtingparen van dezelfde basiscombinatie op
 * dezelfde plaats. M_y en N blijven per variant: om y neemt de kern de eerste
 * orde mét scheefstand, net als in 2D (de imperfectie om y volgt in fase 5).
 * Een basiscombinatie zonder volledig paar houdt haar eigen M_z.
 */
export function eersteOrdeZonderScheefstandOmZ(punten: readonly ForcePoint[]): ForcePoint[] {
  const sleutel = (p: ForcePoint) => `${p.combination_id % SCHEEFSTAND_COMBO_OFFSET}|${p.position_mm}`;
  const groepen = new Map<string, Map<number, number>>();
  for (const p of punten) {
    const k = sleutel(p);
    const groep = groepen.get(k) ?? new Map<number, number>();
    groep.set(Math.floor(p.combination_id / SCHEEFSTAND_COMBO_OFFSET), p.forces.mz_ed);
    groepen.set(k, groep);
  }
  const gemiddelde = new Map<string, number>();
  for (const [k, groep] of groepen) {
    // Richtingparen: 0 (+X) met 1 (−X), 2 (+Y) met 3 (−Y).
    const waarden: number[] = [];
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const ma = groep.get(a), mb = groep.get(b);
      if (ma !== undefined && mb !== undefined) waarden.push(ma, mb);
    }
    if (waarden.length > 0) gemiddelde.set(k, waarden.reduce((t, v) => t + v, 0) / waarden.length);
  }
  return punten.map((p) => {
    const m = gemiddelde.get(sleutel(p));
    return m === undefined ? p : { ...p, forces: { ...p.forces, mz_ed: m } };
  });
}

export interface OpenFem3DConcreteChecks {
  results: ConcreteBeamCheckResult[];
  skipped: OpenFem3DCheckSkip[];
  notes: string[];
}

/**
 * Bouw EN 1992-invoer uit precies dezelfde zes lokale staafkrachten als de
 * 3D-resultaatweergave. Er worden geen UGT/BGT-combinaties verzonnen: de
 * actuele rekentoestand geldt als één UGT-invoer en de twee BGT-lijsten
 * blijven leeg, zodat de kern scheur- en kruipcontroles zichtbaar weigert.
 */
export function buildOpenFem3DConcreteCheckInputs(
  model: OpenFem3DModel,
  result: OpenFem3DSolveResult,
  combinationSet?: OpenFem3DCombinationSet,
): { inputs: ConcreteBeamCheckInput[]; skipped: OpenFem3DCheckSkip[]; notes: string[] } {
  const inputs: ConcreteBeamCheckInput[] = [];
  const skipped: OpenFem3DCheckSkip[] = [];
  const notes = [
    combinationSet
      ? "De 3D-betonkrachten zijn omhuld over de berekende UGT-combinaties; frequente en quasi-blijvende BGT-combinaties gaan afzonderlijk naar de normkern."
      : "De actuele 3D-rekentoestand wordt als één UGT-invoer getoetst; er is geen combinatieset meegegeven.",
    "N, Vy, Vz, T, My en Mz komen op alle solverstations uit de lokale 3D-staafkrachten. De gewone liggerdoorsnedetoetsen van de huidige EN 1992-kern gebruiken My en Vz; een afzonderlijke toets om de tweede buig- en dwarskrachtas is daar nog niet beschikbaar.",
    "Mz wordt wel meegenomen in de dubbele-buigingstoets van §5.8 wanneer voor de staaf volledige kolomgegevens zijn opgegeven. Zonder die kolominvoer is N-My-Mz niet volledig getoetst.",
    "EN 1992-torsie en de interactie van torsie met dwarskracht zijn in de huidige betonkern nog niet beschikbaar en worden daarom niet als voldaan gemeld.",
    combinationSet
      ? "De BGT-omhullenden volgen uitdrukking 6.15b (frequent) en 6.16b (quasi-blijvend); ontbrekende soorten blijven zichtbaar leeg."
      : "De frequente en quasi-blijvende BGT-omhullenden zijn leeg; scheurwijdte, kruip en bijbehorende BGT-controles melden expliciet dat invoer ontbreekt.",
    // De toetsset (issue #199): de UGT-krachten zijn tweede orde met scheefstand.
    ...(combinationSet?.toetsAnalyse ? [toetsKrachtenNotitie3D(combinationSet.toetsAnalyse, "beton")] : []),
    ...(combinationSet?.eersteOrdeResultaten
      ? ["§5.8 bij een kolom met kolomblok: M₀Ed, M₀₁ en M₀₂ (r_m) en M₀Eqp van (5.19) komen om beide assen uit de EERSTE ORDE van dezelfde UGT-varianten en van de quasi-blijvende combinatie (first_order_envelope); N_Ed en de doorsnedetoetsen uit de tweede-ordekrachten van de toets. Om y met de scheefstand van de variant, zoals in 2D. Om z zonder de globale scheefstand: de kern telt daar de imperfectie e_i (§5.2) en e₂ zelf op, zodat imperfectie en tweede orde om z één keer tellen."]
      : []),
  ];
  const memberForces = new Map(result.memberForces.map((value) => [value.memberId, value]));
  const ulsCombinations = combinationSet?.combinations.filter((combination) =>
    combination.type === "uls" && combinationSet.results.has(combination.id)) ?? [];
  const slsCombinations = combinationSet?.combinations.filter((combination) =>
    combination.type === "sls" && combinationSet.results.has(combination.id)) ?? [];
  const frequentCombinations = combinatiesVanSoort([...slsCombinations], "6.15b");
  const quasiCombinations = combinatiesVanSoort([...slsCombinations], "6.16b");

  for (const beam of model.beams) {
    const concreteClass = matchSupportedConcreteClass(beam.material);
    if (!concreteClass) continue;
    const parsed = parseConcreteSection(beam.profileName);
    if (!parsed.ok) {
      skipped.push({ beamId: beam.id, reason: parsed.reden });
      continue;
    }
    const cage = beam.checkConfig?.betonKorf;
    if (!cage) {
      skipped.push({ beamId: beam.id, reason: "geen wapeningskorf opgegeven — kies het betonprofiel opnieuw en vul de wapening in" });
      continue;
    }
    const forces = memberForces.get(beam.id);
    if (!forces) {
      skipped.push({ beamId: beam.id, reason: "geen 3D-staafkrachten beschikbaar — bereken het model opnieuw" });
      continue;
    }
    const cfg = beam.checkConfig;
    const envelopeFor = (
      combinations: typeof ulsCombinations,
      results: ReadonlyMap<number, OpenFem3DSolveResult> | undefined = combinationSet?.results,
    ) => combinations.flatMap((combination) => {
      const combinationResult = results?.get(combination.id);
      return combinationResult ? openFem3DForceStations(combinationResult, beam.id, combination.id) : [];
    });
    const ulsEnvelope = envelopeFor(ulsCombinations);
    // Met een toetsset nooit terug naar `result` (het actieve geval, eerste
    // orde zonder scheefstand): zie de staalbouwer.
    if (ulsEnvelope.length === 0 && combinationSet?.toetsAnalyse) {
      skipped.push({ beamId: beam.id, reason: GEEN_UGT_TOETSCOMBINATIE });
      continue;
    }
    // DE EERSTE ORDE VOOR §5.8 (issue #199, B11; zoals in 2D, `betonCheckBuilder`).
    // Alleen bij een kolomblok: zonder §5.8-toets leest de kern haar niet. De
    // toetsset is altijd tweede orde met scheefstand; r_m, M₀Ed en M₀Eqp horen
    // eerste orde te zijn. Zonder dit veld blijft de invoer zoals hij was.
    const eersteOrde = cfg?.betonKolom ? combinationSet?.eersteOrdeResultaten : undefined;
    inputs.push({
      bijlage: "NL",
      beam_id: beam.id,
      section: parsed.doorsnede,
      concrete_class: concreteClass,
      reinforcement_grade: cfg?.betonStaalsoort ?? DEFAULT_REINFORCEMENT_GRADE,
      cage,
      reinforcement_zones: cfg?.betonZones ?? { longitudinal: [], stirrups: [] },
      length_m: forces.lengthM,
      forces_envelope: ulsEnvelope.length > 0 ? ulsEnvelope : openFem3DForceStations(result, beam.id),
      sls_frequent_envelope: envelopeFor(frequentCombinations),
      // M₀Eqp van (5.19) is een eerste-ordemoment: met kolomblok uit de eerste orde.
      sls_quasi_permanent_envelope: envelopeFor(quasiCombinations, eersteOrde ?? combinationSet?.results),
      // M₀Ed, M₀₁ en M₀₂ uit de eerste orde van dezelfde UGT-varianten. Leeg als
      // er niets is: dan weigert de kern §5.8 met reden in plaats van r_m uit
      // de tweede-ordemomenten te halen.
      // Om z zonder de globale scheefstand: de kern voegt e_i en e₂ om z zelf
      // toe (`eersteOrdeZonderScheefstandOmZ`).
      ...(eersteOrde ? { first_order_envelope: eersteOrdeZonderScheefstandOmZ(envelopeFor(ulsCombinations, eersteOrde)) } : {}),
      n_strips: cfg?.betonStroken && cfg.betonStroken > 0 ? Math.round(cfg.betonStroken) : DEFAULT_N_STRIPS,
      steel_branch: cfg?.betonStaaltak ?? "Horizontal",
      design_situation: "PersistentTransient",
      apply_min_eccentricity: true,
      ...(cfg?.betonMilieuklasse ? { exposure_class: cfg.betonMilieuklasse } : {}),
      ...(cfg?.betonConstructieklasse ? { structural_class: cfg.betonConstructieklasse } : {}),
      ...(cfg?.betonKolom ? { column: cfg.betonKolom } : {}),
    });
  }
  return { inputs, skipped, notes };
}

export async function runOpenFem3DConcreteChecks(
  model: OpenFem3DModel,
  result: OpenFem3DSolveResult,
  combinationSet?: OpenFem3DCombinationSet,
): Promise<OpenFem3DConcreteChecks> {
  const built = buildOpenFem3DConcreteCheckInputs(model, result, combinationSet);
  const results = built.inputs.length > 0
    ? await roepKern<ConcreteBeamCheckResult[]>("check_concrete_beams", built.inputs)
    : [];
  return { results, skipped: built.skipped, notes: built.notes };
}
