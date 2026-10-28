/**
 * koudgevormdCheckBuilder.ts — de invoer voor de EN 1993-1-3-kern
 * (`check_koudgevormd_beams`, crate `koudgevormd-check`) uit het model (issue #4).
 *
 * WELKE STAVEN
 * Een staaf met een materiaal `KV:<staalsoort>`. Een onbekende staalsoort,
 * een profiel dat geen KV-C/KV-Z/KV-U is of een staaf zonder krachtsverloop
 * komt met reden in `skipped` — nooit stil naar een andere kern. Een KV-profiel
 * met een gewone staalsoort (bijv. "S235") komt NIET hier en ook niet in de
 * toets voor warmgewalst staal: die meldt hem als overgeslagen.
 *
 * ZIJDELINGSE STEUN
 * `checkConfig.kvZijdelingsGesteund`. Zonder die verklaring blijft kip (§6.2.4)
 * "niet getoetst" en geeft de kern nooit "voldoet" bij een buigend moment.
 */
import type { Beam, Node } from "../components/fem/femTypes";
import type { SolverResult } from "../components/fem/solver/types";
import type { LoadCombination } from "../components/fem/solver/combinations";
import { zonderBgtEindtoestand } from "../components/fem/solver/combinations";
import type { KoudgevormdBeamCheckInput } from "./types/koudgevormd/KoudgevormdBeamCheckInput";
import type { CheckSkip } from "./checkTypes";
import { beamLengthMm, buildForcesEnvelope, extractFieldDeflectionMm } from "./steelCheckBuilder";
import { toetsdataInReferentierichting } from "./referentierichting";
import { isKoudgevormdMateriaal, parseKoudgevormdMateriaal, KOUDGEVORMD_STAALSOORTEN } from "./koudgevormdMateriaal";
import { parseKoudgevormdProfiel } from "./koudgevormdProfiel";

export interface KoudgevormdBuildData {
  nodes: Node[];
  beams: Beam[];
  combinations: LoadCombination[];
  combinationResults: Map<number, SolverResult>;
}

export interface KoudgevormdBuildResult {
  inputs: KoudgevormdBeamCheckInput[];
  skipped: CheckSkip[];
}

export function buildKoudgevormdCheckInputs(ruweData: KoudgevormdBuildData): KoudgevormdBuildResult {
  const data = toetsdataInReferentierichting(ruweData);
  const inputs: KoudgevormdBeamCheckInput[] = [];
  const skipped: CheckSkip[] = [];
  const ulsCombos = data.combinations.filter((c) => c.type === "uls");
  const slsCombos = zonderBgtEindtoestand(data.combinations.filter((c) => c.type === "sls"));

  for (const beam of data.beams) {
    if (!isKoudgevormdMateriaal(beam.material)) continue;
    const mat = parseKoudgevormdMateriaal(beam.material);
    if (!mat) {
      skipped.push({
        beamId: beam.id,
        reason: `staalsoort "${beam.material}" wordt door de EN 1993-1-3-toets niet ondersteund — kies uit ${KOUDGEVORMD_STAALSOORTEN.join(", ")}`,
      });
      continue;
    }
    if (beam.profileEnd) {
      skipped.push({ beamId: beam.id, reason: "verlopend koudgevormd profiel wordt door de EN 1993-1-3-toets niet ondersteund" });
      continue;
    }
    const doorsnede = parseKoudgevormdProfiel(beam.profile);
    if (!doorsnede) {
      skipped.push({
        beamId: beam.id,
        reason: `profiel "${beam.profile ?? "—"}" is geen geldig koudgevormd profiel — gebruik KV-C h×b×c×t rR, KV-Z h×b×c×t rR of KV-U h×b×t rR`,
      });
      continue;
    }
    const lengthMm = beamLengthMm(beam, data.nodes);
    if (lengthMm <= 0) {
      skipped.push({ beamId: beam.id, reason: "staaflengte is 0 — knopen ontbreken" });
      continue;
    }
    if (!ulsCombos.some((c) => data.combinationResults.get(c.id)?.elements.has(beam.id))) {
      skipped.push({ beamId: beam.id, reason: "geen krachtsverloop in de UGT-combinaties — reken het model eerst door" });
      continue;
    }
    const cfg = beam.checkConfig ?? {};
    const lengthM = lengthMm / 1000;
    // Doorbuiging alleen bij een opgegeven eigen grens L/n (projecteis).
    let deflection: number | undefined;
    let noemer: number | undefined;
    if (cfg.deflectionClass === "custom" && Number.isFinite(cfg.deflectionLimitNumerator) && (cfg.deflectionLimitNumerator ?? 0) > 0) {
      noemer = cfg.deflectionLimitNumerator;
      deflection = 0;
      for (const c of slsCombos) {
        const w = Math.abs(extractFieldDeflectionMm(beam, data.combinationResults.get(c.id) ?? null));
        if (w > deflection) deflection = w;
      }
    }
    const input: KoudgevormdBeamCheckInput = {
      beam_id: beam.id,
      section_name: beam.profile ?? "",
      doorsnede,
      staalsoort: mat.aanduiding,
      length_m: lengthM,
      forces_envelope: buildForcesEnvelope(beam.id, ulsCombos, data.combinationResults),
      // Zonder opgave: de systeemlengte van de staaf, in beide richtingen; l_T
      // laat de kern op de staaflengte (gaffelopleggingen).
      buckling_length_y_m: cfg.bucklingLengthY_m && cfg.bucklingLengthY_m > 0 ? cfg.bucklingLengthY_m : lengthM,
      buckling_length_z_m: cfg.bucklingLengthZ_m && cfg.bucklingLengthZ_m > 0 ? cfg.bucklingLengthZ_m : lengthM,
      zijdelings_gesteund: cfg.kvZijdelingsGesteund === true,
    };
    if (deflection !== undefined && noemer !== undefined) {
      input.deflection_mm = deflection;
      input.deflection_limit_numerator = noemer;
    }
    inputs.push(input);
  }
  return { inputs, skipped };
}
