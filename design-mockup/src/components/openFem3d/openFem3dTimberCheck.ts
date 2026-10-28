import { belastingduurPerCombinatie, langsteKlasse } from "../../lib/belastingduur";
import { blijvendeZakking } from "../../lib/blijvendeZakking";
import { kipsteunenVanStaaf } from "../../lib/kipsteunen";
import { bepaalVerloop } from "../../lib/sectionResolver";
import {
  kCrUitConfig, mapLoadDuration, mapLtbLoadPosition, mapServiceClass,
  matchSupportedTimberGrade, parseTimberRectMm, timberDeflectionNumerators,
} from "../../lib/timberCheckBuilder";
import type { TimberBeamCheckInput } from "../../lib/types/timber/TimberBeamCheckInput";
import type { TimberBeamCheckResult } from "../../lib/types/timber/TimberBeamCheckResult";
import type { LtbLoadCase } from "../../lib/types/timber/LtbLoadCase";
import { combinatiesVanSoort, zonderBgtEindtoestand } from "../fem/solver/combinations";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import { openFem3DMemberFieldDeflectionMm } from "./openFem3dDisplacement";
import { openFem3DEinden, openFem3DUitkragingNotitie, type OpenFem3DEinden } from "./openFem3dUitkraging";
import { openFem3DForceStations } from "./openFem3dForceStations";
import type { OpenFem3DCheckSkip, OpenFem3DCombinationSet } from "./openFem3dSteelCheck";
import {
  eigenNaamVan, isEigenProfiel, naarCustomSection, zoekEigenDoorsnede,
} from "../../lib/profieleditor/eigenDoorsnedenStore";

export interface OpenFem3DTimberChecks {
  results: TimberBeamCheckResult[];
  skipped: OpenFem3DCheckSkip[];
  notes: string[];
}

export function openFem3DTimberUlsUc(result: TimberBeamCheckResult): number {
  return result.checks.reduce((maximum, check) =>
    check.id.startsWith("deflection_") || check.id.startsWith("sls_")
      ? maximum : Math.max(maximum, check.kind.data.uc?.uc ?? 0), 0);
}

export function openFem3DTimberGoverningUlsCheck(result: TimberBeamCheckResult) {
  return result.checks
    .filter((check) => !check.id.startsWith("deflection_") && !check.id.startsWith("sls_") && check.kind.data.uc)
    .reduce<(typeof result.checks)[number] | undefined>((highest, check) =>
      (check.kind.data.uc?.uc ?? 0) > (highest?.kind.data.uc?.uc ?? -1) ? check : highest, undefined);
}


function mixedCreepReason(model: OpenFem3DModel, beam: OpenFem3DModel["beams"][number]): string | null {
  const connectedNodes = new Set([beam.startNodeId, beam.endNodeId]);
  const connectedBeams = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const member of model.beams) {
      if (connectedBeams.has(member.id)
        || (!connectedNodes.has(member.startNodeId) && !connectedNodes.has(member.endNodeId))) continue;
      connectedBeams.add(member.id);
      connectedNodes.add(member.startNodeId);
      connectedNodes.add(member.endNodeId);
      changed = true;
    }
  }
  const grade = matchSupportedTimberGrade(beam.material);
  const service = mapServiceClass(beam.checkConfig?.serviceClass);
  const different = model.beams.some((member) => connectedBeams.has(member.id)
    && (matchSupportedTimberGrade(member.material) !== grade
      || mapServiceClass(member.checkConfig?.serviceClass) !== service));
  const plate = (model.plates ?? []).some((item) => item.nodeIds.some((id) => connectedNodes.has(id)));
  return different || plate
    ? "verbonden staven of platen hebben verschillend kruipgedrag; w_qp,fin uit een 3D-eindstijfheidsberekening ontbreekt (EN 1995-1-1 2.2.3(4))"
    : null;
}

function ltbLoadCase(
  model: OpenFem3DModel, beam: OpenFem3DModel["beams"][number], lengthM: number, einden: OpenFem3DEinden,
): { loadCase: LtbLoadCase; note: string } {
  const cantilever = einden.vrijEind(beam, beam.startNodeId) || einden.vrijEind(beam, beam.endNodeId);
  const lines = (model.memberLoads ?? []).filter((load) => load.beamId === beam.id);
  const points = (model.memberPointLoads ?? []).filter((load) => load.beamId === beam.id);
  const nodal = (model.loads ?? []).filter((load) => load.nodeId === beam.startNodeId || load.nodeId === beam.endNodeId);
  const endMoment = nodal.some((load) => Math.abs(load.my) > 1e-12 || Math.abs(load.mz) > 1e-12);
  const continuous = model.beams.some((other) => other.id !== beam.id
    && [other.startNodeId, other.endNodeId].some((id) => id === beam.startNodeId || id === beam.endNodeId));
  const uniform = lines.length > 0 && lines.every((load) => {
    const fullSpan = Math.abs(load.startPositionM) < 1e-9 && Math.abs(load.endPositionM - lengthM) < 1e-9;
    return fullSpan && (load.globalDirection
      ? Math.abs(load.qStart - load.qEnd) < 1e-9
      : Math.abs(load.qyStart - load.qyEnd) < 1e-9 && Math.abs(load.qzStart - load.qzEnd) < 1e-9);
  });
  if (cantilever && !endMoment && (points.length > 0 || nodal.length > 0)) {
    return { loadCase: "CantileverConcentratedEnd", note: "Kip: uitkraging met eindlast; tabel 6.1, l_ef = 0,8·L. Bij meerdere lastvormen is dit de conservatieve tabelrij." };
  }
  if (cantilever && uniform && points.length === 0 && nodal.length === 0) {
    return { loadCase: "CantileverUniform", note: "Kip: uitkraging met gelijkmatig verdeelde belasting; tabel 6.1, l_ef = 0,5·L." };
  }
  if (!cantilever && !continuous && uniform && points.length === 0 && nodal.length === 0) {
    return { loadCase: "UniformLoad", note: "Kip: volle gelijkmatig verdeelde belasting; tabel 6.1, l_ef = 0,9·L." };
  }
  return { loadCase: "ConstantMoment", note: "Kip: lastvorm wijkt af van de herkende tabelgevallen; l_ef = L is als conservatieve bovengrens van tabel 6.1 gebruikt, niet als beschrijving van het werkelijke momentverloop." };
}

export function buildOpenFem3DTimberCheckInputs(
  model: OpenFem3DModel,
  result: OpenFem3DSolveResult,
  combinationSet?: OpenFem3DCombinationSet,
): { inputs: TimberBeamCheckInput[]; skipped: OpenFem3DCheckSkip[]; notes: string[] } {
  const inputs: TimberBeamCheckInput[] = [];
  const skipped: OpenFem3DCheckSkip[] = [];
  const notes = [
    "EN 1995: elke UGT-combinatie wordt op alle 3D-solverstations getoetst; de kern kiest per controle de hoogste UC.",
    "Kruip gebruikt bij één kruipgedrag EN 1995-1-1 2.2.3(5): w_fin = w_inst + k_def·w_qp. Zonder vereiste BGT-combinaties of bij verschillend kruipgedrag krijgt de zakking geen UC.",
  ];
  const combinations = combinationSet?.combinations ?? [];
  const uls = combinations.filter((c) => c.type === "uls" && combinationSet?.results.has(c.id));
  const sls = zonderBgtEindtoestand(combinations.filter((c) => c.type === "sls" && combinationSet?.results.has(c.id)));
  const characteristic = combinatiesVanSoort(sls, "6.14b");
  const quasi = combinatiesVanSoort(sls, "6.16b");
  // Uitkraging (precies één vrij eind, of de klasse "uitkraging" zonder herkend
  // vrij eind): de zakking vanaf het ingeklemde eind, niet vanaf de koorde
  // (controle 2026-10, punt K5). Dezelfde herkenning als de staaltoets: een
  // knoop op een plaat, een oplegging, een andere staaf of bedding maakt een
  // eind niet vrij (`openFem3dUitkraging.ts`).
  const einden = openFem3DEinden(model);
  const deflection = (beam: OpenFem3DModel["beams"][number], candidates: typeof sls) =>
    candidates.reduce((max, c) => {
      const solved = combinationSet?.results.get(c.id);
      return solved ? Math.max(max, openFem3DMemberFieldDeflectionMm(model, beam, solved, einden.inklemming(beam))) : max;
    }, 0);

  for (const beam of model.beams) {
    const grade = matchSupportedTimberGrade(beam.material);
    if (!grade) continue;
    const profile = beam.profileName?.trim() ?? "";
    let custom: TimberBeamCheckInput["custom_section"];
    let rect = parseTimberRectMm(profile);
    let b = rect?.bMm, h = rect?.hMm;
    if (isEigenProfiel(profile)) {
      const eigen = zoekEigenDoorsnede(profile);
      if (!eigen) {
        skipped.push({ beamId: beam.id, reason: `eigen doorsnede "${eigenNaamVan(profile)}" is niet bewaard` });
        continue;
      }
      custom = naarCustomSection(eigen);
      if (custom.lamellen.length === 0) {
        skipped.push({ beamId: beam.id, reason: `eigen doorsnede "${eigen.naam}" heeft geen lamellen voor de houttoets` });
        continue;
      }
      b = eigen.motor.y_max_mm - eigen.motor.y_min_mm;
      h = eigen.motor.z_max_mm - eigen.motor.z_min_mm;
    }
    if (!(b && h && b > 0 && h > 0)) {
      skipped.push({ beamId: beam.id, reason: `profiel "${profile}" is geen toetsbare houtdoorsnede b×h` });
      continue;
    }
    const member = result.memberForces.find((force) => force.memberId === beam.id);
    if (!member || !model.nodes.some((node) => node.id === beam.startNodeId)
      || !model.nodes.some((node) => node.id === beam.endNodeId)) {
      skipped.push({ beamId: beam.id, reason: "3D-staafkrachten of geometrie ontbreken" });
      continue;
    }
    const forces = uls.flatMap((c) => {
      const solved = combinationSet?.results.get(c.id);
      return solved ? openFem3DForceStations(solved, beam.id, c.id) : [];
    });
    const envelope = combinationSet ? forces : openFem3DForceStations(result, beam.id);
    if (!envelope.length) {
      skipped.push({ beamId: beam.id, reason: combinationSet
        ? "geen berekende UGT-combinatie met 3D-staafkrachten voor de houttoets"
        : "geen 3D-krachtsverloop voor de houttoets" });
      continue;
    }
    if (custom && envelope.some((p) => Math.abs(p.forces.vy_ed) > 1e-9 || Math.abs(p.forces.mt_ed) > 1e-9)) {
      skipped.push({ beamId: beam.id, reason: "V_y of torsie op een eigen houtdoorsnede kan nog niet betrouwbaar worden getoetst (S_z of W_tor ontbreekt)" });
      continue;
    }
    const verloop = bepaalVerloop(beam.material, profile, beam.profileNameEnd);
    if (verloop.status === "fout") {
      skipped.push({ beamId: beam.id, reason: verloop.reden });
      continue;
    }
    const cfg = beam.checkConfig ?? {};
    const kcr = kCrUitConfig(cfg);
    if ("fout" in kcr) {
      skipped.push({ beamId: beam.id, reason: kcr.fout });
      continue;
    }
    const kip = kipsteunenVanStaaf(cfg, member.lengthM * 1000, "hout");
    const ltb = ltbLoadCase(model, beam, member.lengthM, einden);
    const inklemming = einden.inklemming(beam);
    const klasseLimits = timberDeflectionNumerators(cfg.deflectionClass, cfg.deflectionLimitNumerator);
    // Een vrij eind maakt de staaf een uitkraging: ℓ_rep = 2·L, dus de noemers
    // op de staaflengte gehalveerd, zoals de klasse "uitkraging" al doet.
    const vrijEindZonderKlasse = (inklemming === "begin" || inklemming === "eind")
      && cfg.deflectionClass !== "cantilever" && cfg.deflectionClass !== "custom";
    const limits = vrijEindZonderKlasse
      ? { fin: klasseLimits.fin / 2, add: klasseLimits.add / 2 }
      : klasseLimits;
    const loadCases = combinationSet?.loadCases?.map((lc) => ({ ...lc, name: `Belastinggeval ${lc.id}` }));
    const duration = loadCases?.length
      ? belastingduurPerCombinatie({
          combinaties: uls, loadCases,
          ondergrens: cfg.loadDuration !== undefined ? mapLoadDuration(cfg.loadDuration) : undefined,
        })
      : [];
    const inst = characteristic.length ? deflection(beam, characteristic)
      : sls.length ? deflection(beam, sls) : openFem3DMemberFieldDeflectionMm(model, beam, result, inklemming);
    const qp = quasi.length ? deflection(beam, quasi) : inst;
    const deflectionReason = !characteristic.length
      ? "karakteristieke BGT-combinatie (6.14b) ontbreekt"
      : !quasi.length
        ? "quasi-blijvende BGT-combinatie (6.16b) ontbreekt"
        : mixedCreepReason(model, beam);
    const permanent = combinationSet ? blijvendeZakking({
      combinations, loadCases: combinationSet.loadCases,
      meet: (c) => {
        const solved = combinationSet.results.get(c.id);
        return solved ? -openFem3DMemberFieldDeflectionMm(model, beam, solved, inklemming) : null;
      },
    }) : { mm: 0, notes: ["Geen combinatieset: w₁ is als nul genomen."] };
    const deflectionNotes = [
      ...notes, ...permanent.notes,
      ...(inklemming ? [
        openFem3DUitkragingNotitie(inklemming) +
          (vrijEindZonderKlasse ? ` Dus w_fin tegen L/${String(Math.round(limits.fin * 1000) / 1000).replace(".", ",")} en w_add tegen L/${String(Math.round(limits.add * 1000) / 1000).replace(".", ",")} op de staaflengte.` : ""),
      ] : []),
      ...(characteristic.length ? [] : ["Karakteristieke BGT-combinatie ontbreekt: w_inst is uit de beschikbare BGT-omhullende genomen."]),
      ...(quasi.length ? [] : ["Quasi-blijvende BGT-combinatie ontbreekt: w_qp = w_inst is veilig-zijdig aangehouden."]),
    ];
    inputs.push({
      bijlage: "NL", beam_id: beam.id, width_mm: b, height_mm: h,
      ...(custom ? { custom_section: custom } : {}),
      ...(verloop.status === "verlopend" ? {
        width_end_mm: verloop.verloop.eind.b,
        height_end_mm: verloop.verloop.eind.h,
      } : {}),
      strength_class: grade,
      service_class: mapServiceClass(cfg.serviceClass),
      load_duration: duration.length ? langsteKlasse(duration.map((d) => d.load_duration)) : mapLoadDuration(cfg.loadDuration),
      load_duration_per_combination: duration,
      length_m: member.lengthM,
      forces_envelope: envelope,
      buckling_length_y_m: cfg.bucklingLengthY_m ?? 0,
      buckling_length_z_m: cfg.bucklingLengthZ_m ?? 0,
      ruimtelijk: true,
      is_cantilever: einden.vrijEind(beam, beam.startNodeId) || einden.vrijEind(beam, beam.endNodeId),
      // `zijdelingse_knik_in_analyse` (L in plaats van 2·L bij P-Δ met
      // scheefstand) gaat bij hout bewust NIET mee: NEN-EN 1995-1-1 eist bij
      // tweede orde E_d = E_mean/γ_M (2.2.2(1)P) en de boogimperfectie van
      // 5.4.4(2), en de 3D-P-Δ rekent met E_mean en zonder boogimperfectie.
      lateral_bracing: kip.lateral_bracing,
      ltb_segment_length_m: kip.ltb_segment_length_m,
      ltb_load_case: ltb.loadCase,
      ltb_load_position: mapLtbLoadPosition(cfg.ltbLoadPosition),
      ltb_effective_length_override_m: 0,
      perform_ltb_check: cfg.performLtbCheck ?? true,
      k_cr: kcr.kCr,
      load_sharing: false,
      deflection_inst_mm: -inst,
      deflection_quasi_perm_mm: -qp,
      deflection_permanent_mm: permanent.mm,
      ...(deflectionReason ? { deflection_not_applicable_reason: deflectionReason } : {}),
      deflection_limit_fin: limits.fin,
      deflection_limit_add: limits.add,
      deflection_notes: deflectionNotes,
      staaf_notities: [
        `3D-raamwerk: knik om y en z wordt ruimtelijk getoetst; vrije einden: ${einden.vrijEind(beam, beam.startNodeId) || einden.vrijEind(beam, beam.endNodeId) ? "ja" : "nee"}.`,
        ltb.note,
      ],
    });
  }
  return { inputs, skipped, notes };
}

export async function runOpenFem3DTimberChecks(
  model: OpenFem3DModel,
  result: OpenFem3DSolveResult,
  combinationSet?: OpenFem3DCombinationSet,
): Promise<OpenFem3DTimberChecks> {
  const built = buildOpenFem3DTimberCheckInputs(model, result, combinationSet);
  const { roepKern } = await import("../../stores/checkStore");
  const results = built.inputs.length
    ? await roepKern<TimberBeamCheckResult[]>("check_timber_beams", built.inputs)
    : [];
  return { results, skipped: built.skipped, notes: built.notes };
}
