import type { LoadCase } from "../fem/femTypes";
import {
  nbc2025CombinationPlan, type Nbc2025CombinationInput, type Nbc2025CombinationPlan,
} from "../../lib/wind/nbc2025Combinations";
import type { NbcRectangularWindBuildingInput } from "../../lib/wind/nbc2025RectangularWindPlan";
import { nbc2025HorizontalWindActions, type Nbc2025HorizontalWindAction } from "../../lib/wind/nbc2025PartialWind";
import { applyGeneratedEnvelopeLoads, type GeneratedEnvelopeLoadResult } from "./openFem3dGeneratedLoads";
import type { OpenFem3DModel } from "./openFem3dModel";
import { generateNbc2025EnvelopeWindLoadsForLimitStates,
  nbc2025ProjectedHorizontalResultants } from "./openFem3dNbc2025Wind";
import { generateNbc2025FlatRoofSnowPanels, type Nbc2025SnowPanelInput } from "./openFem3dNbc2025Snow";
import { applyNbc2025TransferredWindCases, nbc2025TransferPartialWind,
  type Nbc2025WindTransferLevel } from "./openFem3dNbc2025Transfer";
import type { RoofLoadGeneration } from "./openFem3dRoofLoads";

export interface Nbc2025ModelLoadInput extends Omit<Nbc2025CombinationInput,
  "loadCases" | "windCases" | "partialWindCases" | "snowCasePairs"> {
  wind: NbcRectangularWindBuildingInput;
  snow?: Nbc2025SnowPanelInput;
  /** Explicit global lateral load path through supported base nodes and diaphragms. */
  horizontalTransfer?: readonly Nbc2025WindTransferLevel[];
}

export interface Nbc2025ModelLoadPlan extends GeneratedEnvelopeLoadResult, Nbc2025CombinationPlan {
  /** Horizontal 4.1.7.9 actions; transferred when horizontalTransfer is supplied. */
  horizontalWindActions: Nbc2025HorizontalWindAction[];
  transferredCaseIds: number[];
  transferredLoadIds: number[];
}

/**
 * Prepare NBC wind panels and matching D/L/S/W combinations in one operation.
 * This is a project-building block; it does not enable an NBC UI or API route.
 * The caller must establish non-wind loads under NBC and select the applicable
 * provincial code before these results can be used for design.
 */
export function nbc2025ModelLoadPlan(
  model: OpenFem3DModel, loadCases: readonly LoadCase[], input: Nbc2025ModelLoadInput,
): Nbc2025ModelLoadPlan {
  if (loadCases.some((item) => item.gegenereerd?.bron === "envelope3d"
    && item.gegenereerd.windCodeId !== "ca-nbc-2025")
    || (model.loadPanels ?? []).some((panel) => panel.generated?.source === "envelope3d"
      && panel.generated.windCodeId !== "ca-nbc-2025")) {
    throw new Error("NBC 2025 mag bestaande gegenereerde lasten van een andere norm niet vervangen.");
  }
  if (input.snow && input.snow.importanceCategory !== input.wind.importanceCategory) {
    throw new Error("NBC-wind en sneeuw moeten dezelfde projectbelangcategorie gebruiken.");
  }
  const wind = generateNbc2025EnvelopeWindLoadsForLimitStates(model, input.wind);
  const projected = nbc2025ProjectedHorizontalResultants(model, wind);
  const horizontalWindActions = (["uls", "sls"] as const).flatMap((limitState) => {
    const cases = wind.cases.filter((item) => item.limitState === limitState);
    return nbc2025HorizontalWindActions(cases, input.wind.widthXM, input.wind.widthYM,
      new Map(cases.map((item) => [item.key, projected.get(item.key)!])));
  });
  const snow = input.snow ? generateNbc2025FlatRoofSnowPanels(model, input.snow) : undefined;
  const roof: RoofLoadGeneration = snow ?? { roofShape: "none", cases: [], loads: [], warnings: [] };
  const applied = applyGeneratedEnvelopeLoads(model, loadCases, wind, roof);
  const caseIds = new Map(applied.loadCases.map((item) => [item.gegenereerd?.sleutel, item.id]));
  const snowCasePairs = snow?.caseKeyPairs.map((pair) => ({
    uls: caseIds.get(pair.uls)!, sls: caseIds.get(pair.sls)!,
  }));
  const transferredPlans = input.horizontalTransfer
    ? nbc2025TransferPartialWind(model, wind, horizontalWindActions, input.horizontalTransfer) : [];
  const transferred = applyNbc2025TransferredWindCases(applied.model, applied.loadCases,
    transferredPlans, loadCases);
  const combinations = nbc2025CombinationPlan({ ...input,
    loadCases: transferred.loadCases, windCases: wind.cases, snowCasePairs,
    partialWindCases: transferredPlans.map(({ key, action }) => ({ key, action })) });
  const changed = JSON.stringify(transferred.model) !== JSON.stringify(model)
    || JSON.stringify(transferred.loadCases) !== JSON.stringify(loadCases);
  return { ...applied, ...combinations,
    model: changed ? transferred.model : model,
    loadCases: changed ? transferred.loadCases : loadCases as LoadCase[], changed,
    generatedCaseIds: [...applied.generatedCaseIds, ...transferred.caseIds],
    horizontalWindActions, transferredCaseIds: transferred.caseIds, transferredLoadIds: transferred.loadIds };
}
