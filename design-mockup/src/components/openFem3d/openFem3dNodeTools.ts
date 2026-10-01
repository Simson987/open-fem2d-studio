import {
  OPEN_FEM_3D_SUPPORT_PRESETS,
  setOpenFem3DSupport,
  setOpenFem3DSupportSprings,
  type OpenFem3DModel,
  type OpenFem3DSupportPreset,
  type OpenFem3DSupportSprings,
} from "./openFem3dModel";
import type { OpenFem3DSpringAxis } from "./openFem3dCommands";

/**
 * Gereedschappen die een knoopvoorwaarde plaatsen: een oplegging
 * (`support:<preset>`) of een oplegveer (`spring:<as>`). Een klik op een
 * knoop geeft die knoop de voorwaarde; een klik in leeg canvas maakt daar
 * eerst een knoop op het werkvlak. Beide in één modelwijziging, dus één stap
 * ongedaan maken.
 */
export type OpenFem3DNodeCondition =
  | { kind: "support"; preset: OpenFem3DSupportPreset }
  | { kind: "spring"; axis: OpenFem3DSpringAxis };

/** Waar de klik landde: op een bestaande knoop, of op een punt van het werkvlak (m). */
export type OpenFem3DNodeTarget = { nodeId: number } | { position: { x: number; y: number; z: number } };

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
 * Plaats de voorwaarde op het doel: een bestaande knoop, of een punt van het
 * werkvlak. Ligt daar al een knoop (binnen 0,1 µm), dan krijgt die hem;
 * anders komt er een nieuwe knoop. Eén nieuw model, dus één stap ongedaan maken.
 */
export function placeOpenFem3DNodeCondition(
  model: OpenFem3DModel,
  target: OpenFem3DNodeTarget,
  condition: OpenFem3DNodeCondition,
  springStiffness: number,
): { model: OpenFem3DModel; nodeId: number; createdNode: boolean } {
  let next = model;
  let nodeId: number;
  let createdNode = false;
  if ("nodeId" in target) {
    nodeId = target.nodeId;
  } else {
    const { x, y, z } = target.position;
    const existing = model.nodes.find((node) => Math.hypot(node.x - x, node.y - y, node.z - z) < 1e-7);
    if (existing) {
      nodeId = existing.id;
    } else {
      nodeId = model.nodes.reduce((maximum, node) => Math.max(maximum, node.id), 0) + 1;
      next = { ...model, nodes: [...model.nodes, { id: nodeId, x, y, z }] };
      createdNode = true;
    }
  }
  return { model: applyOpenFem3DNodeCondition(next, nodeId, condition, springStiffness), nodeId, createdNode };
}
