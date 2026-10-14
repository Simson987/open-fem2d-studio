import type { LoadCase } from "../../components/fem/femTypes";
import type { LoadCombination } from "../../components/fem/solver/combinations";
import type { NbcRectangularWindCase } from "./nbc2025RectangularWindPlan";
import type { Nbc2025HorizontalWindAction } from "./nbc2025PartialWind";

export const NBC_2025_ULS_COMBINATION_SOURCE =
  "NBC 2025 Vol. 1, Division B, Table 4.1.3.2.-A, https://doi.org/10.4224/26fz-gg26";
export const NBC_2025_SLS_COMBINATION_SOURCE =
  "NBC 2025 Vol. 1, Division B, Table 4.1.3.4., https://doi.org/10.4224/26fz-gg26";

export interface Nbc2025CombinationInput {
  loadCases: readonly LoadCase[];
  windCases: readonly NbcRectangularWindCase[];
  /** Actual b/c/d 3D cases, paired by pattern across ULS and SLS. */
  partialWindCases?: readonly { key: string; action: Nbc2025HorizontalWindAction }[];
  /** Each required snow distribution has separate ULS/SLS cases (4.1.6.2 and 4.1.6.3). */
  snowCasePairs?: readonly { uls: number; sls: number }[];
  firstId: number;
  /** Soil, earth, restrained prestress and imposed deformation need other rules. */
  deadLoadScope: "ordinary-only";
  /** D, L and S must be independently established for the applicable NBC edition. */
  nonWindLoadsVerifiedForNbc2025: true;
  /** Storage/equipment areas use increased live companion factors. */
  liveUse: "ordinary" | "storage-equipment";
  /** This plan covers the non-creep deflection rows, not creep or vibration. */
  serviceability: "noncreep-deflection";
}

export interface Nbc2025CombinationPlan {
  combinations: LoadCombination[];
  ulsSource: typeof NBC_2025_ULS_COMBINATION_SOURCE;
  slsSource: typeof NBC_2025_SLS_COMBINATION_SOURCE;
}

type Term = { symbol: "D" | "L" | "S" | "W"; factor: number; ids: readonly number[] };

/**
 * Pure NBC 2025 D/L/S/W plan without cranes or earthquake. Each combination
 * contains at most one coherent wind case. ULS and SLS reference different
 * wind cases because their Iw factors differ. No project route is enabled here.
 */
export function nbc2025CombinationPlan(input: Nbc2025CombinationInput): Nbc2025CombinationPlan {
  if (!Number.isSafeInteger(input.firstId) || input.firstId <= 0) {
    throw new Error("Het eerste NBC-combinatie-id moet een positief geheel getal zijn.");
  }
  if (input.deadLoadScope !== "ordinary-only" || input.nonWindLoadsVerifiedForNbc2025 !== true
    || input.serviceability !== "noncreep-deflection"
    || (input.liveUse !== "ordinary" && input.liveUse !== "storage-equipment")) {
    throw new Error("NBC-combinaties vragen een expliciet ondersteund last- en gebruiksbereik.");
  }
  const ids = new Set<number>();
  for (const item of input.loadCases) {
    if (!Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)) {
      throw new Error("Belastinggevallen hebben een ongeldig of dubbel id.");
    }
    ids.add(item.id);
    if (item.type === "other") throw new Error("NBC-combinaties ondersteunen geen overige lastsoorten.");
  }
  const dead = input.loadCases.filter((item) => item.type === "dead").map((item) => item.id);
  const live = input.loadCases.filter((item) => item.type === "live");
  const snow = input.loadCases.filter((item) => item.type === "snow");
  if (!dead.length || live.length > 1) {
    throw new Error("NBC-combinaties vragen blijvende lasten en hoogstens één L-geval.");
  }
  const snowPairs = input.snowCasePairs;
  const snowIds = snowPairs?.flatMap((pair) => [pair.uls, pair.sls]) ?? [];
  const snowIdSet = new Set(snowIds);
  if ((snow.length === 0 && snowPairs !== undefined)
    || (snow.length !== 0 && (!snowPairs?.length || snowIds.length !== snow.length
      || snowIdSet.size !== snowIds.length || snow.some((item) => !snowIdSet.has(item.id))))) {
    throw new Error("NBC-sneeuw vraagt volledige, unieke UGT/BGT-paren voor alle verdelingen volgens 4.1.6.2–3.");
  }
  const wind = input.loadCases.filter((item) => item.type === "wind");
  const partial = input.partialWindCases ?? [];
  const plans = new Map<string, { limitState: "uls" | "sls"; partial: boolean }>([
    ...input.windCases.map((item) => [item.key, { limitState: item.limitState, partial: false }] as const),
    ...partial.map((item) => [item.key, { limitState: item.action.limitState, partial: true }] as const),
  ]);
  if (plans.size !== input.windCases.length + partial.length || wind.length !== plans.size) {
    throw new Error("NBC-windgevallen en het drukplan komen niet één-op-één overeen.");
  }
  for (const item of wind) {
    const key = item.gegenereerd?.sleutel;
    const plan = key ? plans.get(key) : undefined;
    if (!plan || item.gegenereerd?.bron !== "envelope3d"
      || item.gegenereerd.windCodeId !== "ca-nbc-2025"
      || !key?.startsWith(plan.partial
        ? `nbc2025:partial:${plan.limitState}:` : `nbc2025:${plan.limitState}:`)) {
      throw new Error("Windbelastinggeval hoort niet bij het NBC 2025-drukplan.");
    }
  }
  const byKey = new Map(wind.map((item) => [item.gegenereerd!.sleutel, item.id]));
  if (byKey.size !== plans.size) {
    throw new Error("NBC-windgevallen en het drukplan komen niet één-op-één overeen.");
  }
  const uls = input.windCases.filter((item) => item.limitState === "uls");
  const sls = input.windCases.filter((item) => item.limitState === "sls");
  const footprint = (item: NbcRectangularWindCase) => `${item.direction}:${item.internalPressureCoefficient}`;
  const ulsFootprints = new Set(uls.map(footprint));
  if ((uls.length !== 4 && uls.length !== 8) || ulsFootprints.size !== uls.length
    || sls.length !== uls.length || new Set(sls.map(footprint)).size !== sls.length
    || sls.some((item) => !ulsFootprints.has(footprint(item)))
    || new Set(uls.map((item) => item.direction)).size !== 4) {
    throw new Error("NBC-combinaties vragen overeenkomstige UGT- en BGT-windgevallen in vier richtingen.");
  }
  const cpiSet = new Set(uls.filter((item) => item.direction === "+X")
    .map((item) => item.internalPressureCoefficient));
  if (cpiSet.size * 4 !== uls.length || uls.some((item) => !cpiSet.has(item.internalPressureCoefficient))) {
    throw new Error("NBC-windrichtingen moeten dezelfde binnendrukgevallen bevatten.");
  }
  const partialFootprint = (item: (typeof partial)[number]) => JSON.stringify([
    item.action.pattern, item.action.internalPressureCoefficient,
    item.action.offsetXM, item.action.offsetYM,
    item.action.pressureCaseKeys.map((key) => key.replace(`:${item.action.limitState}:`, ":state:")),
  ]);
  const partialUls = partial.filter((item) => item.action.limitState === "uls");
  const partialSls = partial.filter((item) => item.action.limitState === "sls");
  const ulsPartialFootprints = new Set(partialUls.map(partialFootprint));
  const fullByKey = new Map(input.windCases.map((item) => [item.key, item]));
  if (partial.length && (partialUls.length !== cpiSet.size * 28
    || partialSls.length !== partialUls.length || ulsPartialFootprints.size !== partialUls.length
    || new Set(partialSls.map(partialFootprint)).size !== partialSls.length
    || partialSls.some((item) => !ulsPartialFootprints.has(partialFootprint(item)))
    || partial.some((item) => {
      const action = item.action;
      return action.pattern === "a" || (action.pattern === "b" ? action.pressureCaseKeys.length !== 1
        : action.pressureCaseKeys.length !== 2)
        || !cpiSet.has(action.internalPressureCoefficient)
        || action.pressureCaseKeys.some((key) => {
          const full = fullByKey.get(key);
          return !full || full.limitState !== action.limitState
            || full.internalPressureCoefficient !== action.internalPressureCoefficient;
        });
    }))) {
    throw new Error("NBC-deelwindcombinaties vragen volledige UGT/BGT-paren voor §4.1.7.9(b–d).");
  }
  const ulsWind = [...uls, ...partialUls];
  const slsWind = [...sls, ...partialSls];

  const d = (factor: number): Term => ({ symbol: "D", factor, ids: dead });
  const l = (factor: number): Term => ({ symbol: "L", factor, ids: live.map((item) => item.id) });
  const s = (factor: number, id: number): Term => ({ symbol: "S", factor, ids: [id] });
  const w = (factor: number, item: { key: string }): Term =>
    ({ symbol: "W", factor, ids: [byKey.get(item.key)!] });
  const hasL = live.length > 0;
  const ulsSnowIds = snowPairs?.map((pair) => pair.uls) ?? [];
  const slsSnowIds = snowPairs?.map((pair) => pair.sls) ?? [];
  const liveUlsForSnow = input.liveUse === "storage-equipment" ? 1.5 : 1;
  const liveUlsForWind = input.liveUse === "storage-equipment" ? 1 : 0.5;
  const liveSls = input.liveUse === "storage-equipment" ? 0.5 : 0.35;
  const combinations: LoadCombination[] = [];
  const add = (type: "uls" | "sls", row: number, terms: Term[]) => {
    const factors = new Map<number, number>();
    for (const term of terms) for (const id of term.ids) factors.set(id, term.factor);
    const formula = terms.filter((term) => term.ids.length)
      .map((term) => `${term.factor.toFixed(2)}${term.symbol}`).join(" + ");
    const windCase = terms.find((term) => term.symbol === "W");
    const windName = windCase ? ` · ${wind.find((item) => item.id === windCase.ids[0])!.name}` : "";
    const snowCase = terms.find((term) => term.symbol === "S");
    const snowName = snowCase ? ` · S#${snowCase.ids[0]} ${snow.find((item) => item.id === snowCase.ids[0])!.name}` : "";
    combinations.push({ id: input.firstId + combinations.length,
      name: `NBC 2025 ${type.toUpperCase()} ${row}${windName}${snowName} · ${formula}`,
      type, formula, factors });
  };
  add("uls", 1, [d(1.4)]);
  for (const deadFactor of [1.25, 0.9]) {
    if (hasL) {
      add("uls", 2, [d(deadFactor), l(1.5)]);
      for (const snowId of ulsSnowIds) add("uls", 2, [d(deadFactor), l(1.5), s(0.7, snowId)]);
      for (const item of ulsWind) add("uls", 2, [d(deadFactor), l(1.5), w(0.3, item)]);
    }
    for (const snowId of ulsSnowIds) {
      add("uls", 3, [d(deadFactor), s(1, snowId)]);
      if (hasL) add("uls", 3, [d(deadFactor), s(1, snowId), l(liveUlsForSnow)]);
      for (const item of ulsWind) add("uls", 3, [d(deadFactor), s(1, snowId), w(0.3, item)]);
    }
    for (const item of ulsWind) {
      add("uls", 4, [d(deadFactor), w(1, item)]);
      if (hasL) add("uls", 4, [d(deadFactor), w(1, item), l(liveUlsForWind)]);
      for (const snowId of ulsSnowIds) add("uls", 4, [d(deadFactor), w(1, item), s(0.35, snowId)]);
    }
  }
  if (hasL) {
    add("sls", 1, [d(1), l(1)]);
    for (const snowId of slsSnowIds) add("sls", 1, [d(1), l(1), s(0.35, snowId)]);
    for (const item of slsWind) add("sls", 1, [d(1), l(1), w(0.3, item)]);
  }
  for (const item of slsWind) {
    add("sls", 2, [d(1), w(1, item)]);
    if (hasL) add("sls", 2, [d(1), w(1, item), l(liveSls)]);
    for (const snowId of slsSnowIds) add("sls", 2, [d(1), w(1, item), s(0.35, snowId)]);
  }
  for (const snowId of slsSnowIds) {
    add("sls", 3, [d(1), s(1, snowId)]);
    if (hasL) add("sls", 3, [d(1), s(1, snowId), l(liveSls)]);
    for (const item of slsWind) add("sls", 3, [d(1), s(1, snowId), w(0.3, item)]);
  }
  return { combinations, ulsSource: NBC_2025_ULS_COMBINATION_SOURCE,
    slsSource: NBC_2025_SLS_COMBINATION_SOURCE };
}
