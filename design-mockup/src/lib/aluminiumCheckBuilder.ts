/**
 * aluminiumCheckBuilder.ts — de invoer voor de EN 1999-1-1-kern
 * (`check_aluminium_beams`, crate `aluminium-check`) uit het model.
 *
 * WELKE STAVEN
 * Een staaf met een aluminium materiaal (`ALU:<legering>`). Een onbekende
 * legering, een niet-ondersteunde doorsnede of een staaf zonder krachtsverloop
 * komt met reden in `skipped` — nooit stil naar een andere kern.
 *
 * DOORSNEDE
 *  - "ALU-I h×b×tw×tf" en "ALU-K h×b×t" (`aluminiumProfiel.ts`);
 *  - "b×h": massieve rechthoek;
 *  - een I-profiel uit de staalcatalogus (HEA, IPE, …): als I zonder
 *    afrondingsstralen — veilig, want A, I en W worden kleiner en de vlakke
 *    breedte van de flens groter.
 * Andere vormen (koker/buis/hoek uit de staalcatalogus, eigen doorsneden) zijn
 * in deze eerste versie niet toetsbaar en worden met reden overgeslagen.
 *
 * LASSEN
 * `checkConfig.aluLasstatus` ("geen" of "gelast"). Ontbreekt hij, dan gaat
 * "Onbekend" naar de kern: die rekent veilig alsof gelast en geeft nooit
 * "voldoet" (issue #5: niet stil als ongelast doorrekenen).
 */
import type { Beam, Node } from "../components/fem/femTypes";
import type { SolverResult } from "../components/fem/solver/types";
import type { LoadCombination } from "../components/fem/solver/combinations";
import { zonderBgtEindtoestand } from "../components/fem/solver/combinations";
import type { AluminiumBeamCheckInput } from "./types/aluminium/AluminiumBeamCheckInput";
import type { AluDoorsnede } from "./types/aluminium/AluDoorsnede";
import type { Lasstatus } from "./types/aluminium/Lasstatus";
import type { CheckSkip } from "./checkTypes";
import { beamLengthMm, buildForcesEnvelope, extractFieldDeflectionMm, profileLookupKey } from "./steelCheckBuilder";
import { toetsdataInReferentierichting } from "./referentierichting";
import { parseRechthoek } from "./sectionResolver";
import { STEEL_SECTION_DIMS } from "./steelSectionDims.generated";
import { isAluminiumMateriaal, parseAluminiumMateriaal, ALUMINIUM_LEGERINGEN } from "./aluminiumMateriaal";
import { parseAluminiumProfiel } from "./aluminiumProfiel";

export interface AluminiumBuildData {
  nodes: Node[];
  beams: Beam[];
  combinations: LoadCombination[];
  combinationResults: Map<number, SolverResult>;
}

export interface AluminiumBuildResult {
  inputs: AluminiumBeamCheckInput[];
  skipped: CheckSkip[];
}

/** De doorsnede voor de kern, of de reden waarom die er niet is. */
export function aluminiumDoorsnedeVanProfiel(profile: string | undefined): AluDoorsnede | string {
  const naam = profile?.trim() ?? "";
  if (!naam) return "de staaf heeft geen profiel — kies een aluminium extrusieprofiel (ALU-I, ALU-K) of een rechthoek b×h";
  const alu = parseAluminiumProfiel(naam);
  if (alu) return alu;
  const rect = parseRechthoek(naam);
  if (rect) return { vorm: "Rechthoek", b_mm: rect.b, h_mm: rect.h };
  const d = STEEL_SECTION_DIMS[profileLookupKey(naam)];
  if (d && d.kind === "ISection" && d.h > 2 * d.tf && d.b > d.tw) {
    return { vorm: "IProfiel", h_mm: d.h, b_mm: d.b, tw_mm: d.tw, tf_mm: d.tf };
  }
  return (
    `profiel "${naam}" wordt door de EN 1999-toets nog niet ondersteund — ` +
    "gebruik ALU-I h×b×tw×tf, ALU-K h×b×t, een rechthoek b×h of een I-profiel uit de catalogus"
  );
}

function lasstatusVan(beam: Beam): Lasstatus {
  switch (beam.checkConfig?.aluLasstatus) {
    case "geen": return "Geen";
    case "gelast": return "Gelast";
    default: return "Onbekend";
  }
}

export function buildAluminiumCheckInputs(ruweData: AluminiumBuildData): AluminiumBuildResult {
  const data = toetsdataInReferentierichting(ruweData);
  const inputs: AluminiumBeamCheckInput[] = [];
  const skipped: CheckSkip[] = [];
  const ulsCombos = data.combinations.filter((c) => c.type === "uls");
  const slsCombos = zonderBgtEindtoestand(data.combinations.filter((c) => c.type === "sls"));

  for (const beam of data.beams) {
    if (!isAluminiumMateriaal(beam.material)) continue;
    const mat = parseAluminiumMateriaal(beam.material);
    if (!mat) {
      skipped.push({
        beamId: beam.id,
        reason: `aluminiumlegering "${beam.material}" wordt niet ondersteund — kies uit ${ALUMINIUM_LEGERINGEN.join(", ")}`,
      });
      continue;
    }
    if (beam.profileEnd) {
      skipped.push({ beamId: beam.id, reason: "verlopend aluminiumprofiel wordt door de EN 1999-toets niet ondersteund" });
      continue;
    }
    const doorsnede = aluminiumDoorsnedeVanProfiel(beam.profile);
    if (typeof doorsnede === "string") {
      skipped.push({ beamId: beam.id, reason: doorsnede });
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
    // Doorbuiging: alleen bij een opgegeven eigen grens L/n — EN 1999-1-1 §7.2
    // kent geen grens, en de staalregels van NEN-EN 1990 NB worden hier niet
    // stil overgenomen.
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
    const input: AluminiumBeamCheckInput = {
      beam_id: beam.id,
      section_name: beam.profile ?? "",
      doorsnede,
      legering: mat.aanduiding,
      lasstatus: lasstatusVan(beam),
      length_m: lengthM,
      forces_envelope: buildForcesEnvelope(beam.id, ulsCombos, data.combinationResults),
      // Zonder opgave: de systeemlengte van de staaf, in beide richtingen.
      buckling_length_y_m: cfg.bucklingLengthY_m && cfg.bucklingLengthY_m > 0 ? cfg.bucklingLengthY_m : lengthM,
      buckling_length_z_m: cfg.bucklingLengthZ_m && cfg.bucklingLengthZ_m > 0 ? cfg.bucklingLengthZ_m : lengthM,
      zijdelings_gesteund: cfg.aluZijdelingsGesteund === true,
    };
    if (deflection !== undefined && noemer !== undefined) {
      input.deflection_mm = deflection;
      input.deflection_limit_numerator = noemer;
    }
    inputs.push(input);
  }
  return { inputs, skipped };
}
