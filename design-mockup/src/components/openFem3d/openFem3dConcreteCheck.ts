import {
  DEFAULT_N_STRIPS,
  DEFAULT_REINFORCEMENT_GRADE,
  matchSupportedConcreteClass,
  parseConcreteSection,
} from "../../lib/betonCheckBuilder";
import type { ConcreteBeamCheckInput } from "../../lib/types/concrete/ConcreteBeamCheckInput";
import type { ConcreteBeamCheckResult } from "../../lib/types/concrete/ConcreteBeamCheckResult";
import { roepKern } from "../../stores/checkStore";
import { combinatiesVanSoort } from "../fem/solver/combinations";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import type { OpenFem3DCheckSkip, OpenFem3DCombinationSet } from "./openFem3dSteelCheck";
import { openFem3DForceStations } from "./openFem3dForceStations";

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
    const envelopeFor = (combinations: typeof ulsCombinations) => combinations.flatMap((combination) => {
      const combinationResult = combinationSet?.results.get(combination.id);
      return combinationResult ? openFem3DForceStations(combinationResult, beam.id, combination.id) : [];
    });
    const ulsEnvelope = envelopeFor(ulsCombinations);
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
      sls_quasi_permanent_envelope: envelopeFor(quasiCombinations),
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
