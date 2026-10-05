import {
  OPEN_FEM_3D_SUPPORT_PRESETS,
  setOpenFem3DSupport,
  setOpenFem3DSupportSprings,
  type OpenFem3DModel,
  type OpenFem3DSupportPreset,
  type OpenFem3DSupportSprings,
} from "./openFem3dModel";
import type { OpenFem3DSpringAxis } from "./openFem3dCommands";
import { resolveOpenFem3DPlacementNode, type OpenFem3DPlacementNode, type OpenFem3DPlacementTarget } from "./openFem3dPlaatsen";

/**
 * Gereedschappen die een knoopvoorwaarde plaatsen: een oplegging
 * (`support:<preset>`) of een oplegveer (`spring:<as>`). Een klik op (of
 * binnen de snapzone van) een knoop geeft die knoop de voorwaarde; een klik
 * op een staaf splitst die staaf daar, op een plaat komt er een knoop in het
 * middenvlak, en in leeg canvas een knoop op het werkvlak (openFem3dPlaatsen).
 * Knoop en voorwaarde in één modelwijziging, dus één stap ongedaan maken.
 */
export type OpenFem3DNodeCondition =
  | { kind: "support"; preset: OpenFem3DSupportPreset }
  | { kind: "spring"; axis: OpenFem3DSpringAxis };

/**
 * Waar de klik landde: een bestaande knoop, een punt van het werkvlak (m), een
 * plek op een staaf of een punt op een plaat (zie openFem3dPlaatsen).
 */
export type OpenFem3DNodeTarget = OpenFem3DPlacementTarget;

export const OPEN_FEM_3D_SPRING_KEYS: Record<OpenFem3DSpringAxis, keyof OpenFem3DSupportSprings> = {
  kx: "kxKnPerM", ky: "kyKnPerM", kz: "kzKnPerM",
  krx: "krxKnmPerRad", kry: "kryKnmPerRad", krz: "krzKnmPerRad",
};

/**
 * Beginstijfheid zolang er nog geen waarde is ingevuld, in de eenheden van het
 * model: 10 000 kN/m (= 10 kN/mm) voor een translatieveer, 1000 kNm/rad voor
 * een rotatieveer.
 */
export const OPEN_FEM_3D_DEFAULT_SPRING_STIFFNESS: Record<OpenFem3DSpringAxis, number> = {
  kx: 10_000, ky: 10_000, kz: 10_000, krx: 1_000, kry: 1_000, krz: 1_000,
};

const SPRING_AXES = Object.keys(OPEN_FEM_3D_SPRING_KEYS) as OpenFem3DSpringAxis[];
const STORAGE_KEY = "open-fem-studio.openFem3d.springStiffness";

export function openFem3DNodeConditionOfTool(tool: string): OpenFem3DNodeCondition | null {
  if (tool.startsWith("support:")) {
    const preset = tool.slice("support:".length);
    return preset in OPEN_FEM_3D_SUPPORT_PRESETS ? { kind: "support", preset: preset as OpenFem3DSupportPreset } : null;
  }
  if (tool.startsWith("spring:")) {
    const axis = tool.slice("spring:".length);
    return (SPRING_AXES as string[]).includes(axis) ? { kind: "spring", axis: axis as OpenFem3DSpringAxis } : null;
  }
  return null;
}

function storedSprings(): Partial<Record<OpenFem3DSpringAxis, number>> {
  if (typeof localStorage === "undefined") return {};
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Record<string, unknown> | null;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(SPRING_AXES
      .filter((axis) => typeof saved[axis] === "number" && Number.isFinite(saved[axis]) && (saved[axis] as number) > 0)
      .map((axis) => [axis, saved[axis] as number]));
  } catch {
    return {};
  }
}

/** De laatst ingevulde stijfheid in deze richting, anders de beginwaarde (modeleenheden). */
export function readOpenFem3DSpringStiffness(axis: OpenFem3DSpringAxis): number {
  return storedSprings()[axis] ?? OPEN_FEM_3D_DEFAULT_SPRING_STIFFNESS[axis];
}

/** Onthoud de ingevulde veerstijfheden als beginwaarde voor het volgende veergereedschap. */
export function rememberOpenFem3DSpringStiffness(springs: OpenFem3DSupportSprings): void {
  if (typeof localStorage === "undefined") return;
  const next = storedSprings();
  for (const axis of SPRING_AXES) {
    const value = springs[OPEN_FEM_3D_SPRING_KEYS[axis]];
    if (value !== undefined && Number.isFinite(value) && value > 0) next[axis] = value;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Privé venster of volle opslag: de beginwaarde blijft dan gelden.
  }
}

/** Geef een bestaande knoop de voorwaarde; andere veren en opgelegde waarden blijven staan. */
export function applyOpenFem3DNodeCondition(
  model: OpenFem3DModel,
  nodeId: number,
  condition: OpenFem3DNodeCondition,
  springStiffness: number,
): OpenFem3DModel {
  if (condition.kind === "support") {
    return setOpenFem3DSupport(model, nodeId, OPEN_FEM_3D_SUPPORT_PRESETS[condition.preset]);
  }
  const existing = model.supports?.find((support) => support.nodeId === nodeId)?.springs ?? {};
  return setOpenFem3DSupportSprings(model, nodeId, {
    ...existing, [OPEN_FEM_3D_SPRING_KEYS[condition.axis]]: springStiffness,
  });
}

/**
 * Geef een reeks bestaande knopen dezelfde voorwaarde (bijvoorbeeld alle
 * opleggingen scharnierend): één nieuw model, dus één stap ongedaan maken.
 * Knopen die niet bestaan, worden overgeslagen.
 */
export function applyOpenFem3DNodeConditionToNodes(
  model: OpenFem3DModel,
  nodeIds: readonly number[],
  condition: OpenFem3DNodeCondition,
  springStiffness: number,
): OpenFem3DModel {
  const bestaand = new Set(model.nodes.map((node) => node.id));
  return [...new Set(nodeIds)].filter((id) => bestaand.has(id))
    .reduce((next, nodeId) => applyOpenFem3DNodeCondition(next, nodeId, condition, springStiffness), model);
}

/**
 * Plaats de voorwaarde op het doel: een bestaande knoop, een plek op een staaf
 * (die daar gesplitst wordt), een punt op een plaat (nieuwe knoop in het
 * middenvlak) of een punt van het werkvlak (de knoop die daar binnen 0,1 µm
 * ligt, of een nieuwe). Eén nieuw model, dus één stap ongedaan maken. Een
 * ongeldig doel (in een opening, buiten de plaat of staaf) is een fout.
 */
export function placeOpenFem3DNodeCondition(
  model: OpenFem3DModel,
  target: OpenFem3DNodeTarget,
  condition: OpenFem3DNodeCondition,
  springStiffness: number,
): { model: OpenFem3DModel; nodeId: number; createdNode: boolean; created: OpenFem3DPlacementNode["created"]; split?: OpenFem3DPlacementNode["split"] } {
  const placed = resolveOpenFem3DPlacementNode(model, target);
  return {
    model: applyOpenFem3DNodeCondition(placed.model, placed.nodeId, condition, springStiffness),
    nodeId: placed.nodeId,
    createdNode: placed.created !== "existing",
    created: placed.created,
    ...(placed.split ? { split: placed.split } : {}),
  };
}

/**
 * Eén klik met een oplegging- of veergereedschap, zoals App.tsx hem verwerkt
 * (applyOpenFem3DNodeTool): de voorwaarde van het gereedschap op het doel,
 * een veer met de laatst ingevulde stijfheid. Eén nieuw model, dus één
 * modelwijziging en één stap ongedaan maken. `null`: het gereedschap plaatst
 * geen voorwaarde, of de aangeklikte knoop bestaat niet (meer).
 */
export function openFem3DNodeToolClick(
  model: OpenFem3DModel, target: OpenFem3DNodeTarget, tool: string,
): { model: OpenFem3DModel; nodeId: number; condition: OpenFem3DNodeCondition } | null {
  const condition = openFem3DNodeConditionOfTool(tool);
  if (!condition) return null;
  if ("nodeId" in target && !model.nodes.some((node) => node.id === target.nodeId)) return null;
  const stiffness = condition.kind === "spring" ? readOpenFem3DSpringStiffness(condition.axis) : 0;
  const placed = placeOpenFem3DNodeCondition(model, target, condition, stiffness);
  return { model: placed.model, nodeId: placed.nodeId, condition };
}
