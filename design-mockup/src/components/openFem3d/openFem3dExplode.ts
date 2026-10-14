import type { OpenFem3DModel } from "./openFem3dModel";
import { openFem3DLevelsByHeight, type OpenFem3DLevel } from "./openFem3dLevels";
import type { OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import type { StructuralGrid } from "../fem/femTypes";

/** A view-only vertical separation, expressed in metres per level. */
export interface OpenFem3DExplode {
  mode: "levels";
  amountM: number;
}

export const DEFAULT_OPEN_FEM_3D_EXPLODE: OpenFem3DExplode = { mode: "levels", amountM: 0 };
export const MAX_OPEN_FEM_3D_EXPLODE_M = 10;

export function normalizeOpenFem3DExplode(value: unknown): OpenFem3DExplode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_OPEN_FEM_3D_EXPLODE;
  const raw = value as Record<string, unknown>;
  return {
    mode: "levels",
    amountM: typeof raw.amountM === "number" && Number.isFinite(raw.amountM)
      ? Math.max(0, Math.min(MAX_OPEN_FEM_3D_EXPLODE_M, raw.amountM)) : 0,
  };
}

function heightRank(model: OpenFem3DModel, levels: readonly OpenFem3DLevel[]) {
  const sortedLevels = openFem3DLevelsByHeight(levels);
  const heights = sortedLevels.length > 1
    ? [...new Set(sortedLevels.map((level) => level.position / 1000))]
    : [...new Set(model.nodes.map((node) => node.z))].sort((a, b) => a - b);
  const levelIndex = new Map(sortedLevels
    .map((level) => [level.id, heights.findIndex((height) => height === level.position / 1000)] as const)
    .filter((entry) => entry[1] >= 0));
  const rank = (z: number) => {
    let index = 0;
    for (let i = 1; i < heights.length; i += 1) {
      if (z < heights[i] - 1e-6) break;
      index = i;
    }
    return index;
  };
  return { heights, levelIndex, rank };
}

/** Mesh nodes from the solver have no level id; use the floor at or below z. */
export function openFem3DExplodedMesh(
  mesh: OpenFem3DPlateMesh | null, model: OpenFem3DModel,
  levels: readonly OpenFem3DLevel[], explode: OpenFem3DExplode,
): OpenFem3DPlateMesh | null {
  if (!mesh || !(explode.amountM > 0)) return mesh;
  const { heights, rank } = heightRank(model, levels);
  if (heights.length < 2) return mesh;
  return { ...mesh, nodes: mesh.nodes.map((node) => ({ ...node, z: node.z + rank(node.z) * explode.amountM })) };
}

/** Level guides and peilmaten follow the same visual separation. */
export function openFem3DExplodedGrid(grid: StructuralGrid | undefined, explode: OpenFem3DExplode): StructuralGrid | undefined {
  if (!grid || !(explode.amountM > 0) || grid.zAxes.length < 2) return grid;
  const heights = [...new Set(grid.zAxes.map((axis) => axis.position))].sort((a, b) => a - b);
  return { ...grid, zAxes: grid.zAxes.map((axis) => ({
    ...axis, position: axis.position + heights.indexOf(axis.position) * explode.amountM * 1000,
  })) };
}

/**
 * Only node positions change. Member ends therefore stretch between levels;
 * plates, attached loads, symbols, selections and result geometry share the
 * same displaced nodes. The solver always receives the original model.
 */
export function openFem3DExplodedModel(
  model: OpenFem3DModel, levels: readonly OpenFem3DLevel[], explode: OpenFem3DExplode,
): OpenFem3DModel {
  if (!(explode.amountM > 0) || model.nodes.length === 0) return model;
  const { heights, levelIndex, rank } = heightRank(model, levels);
  if (heights.length < 2) return model;
  const nodes = model.nodes.map((node) => ({
    ...node,
    z: node.z + (levelIndex.get(node.levelId ?? "") ?? rank(node.z)) * explode.amountM,
  }));
  const before = new Map(model.nodes.map((node) => [node.id, node]));
  const after = new Map(nodes.map((node) => [node.id, node]));
  const scaleByBeam = new Map(model.beams.map((beam) => {
    const a = before.get(beam.startNodeId), b = before.get(beam.endNodeId);
    const c = after.get(beam.startNodeId), d = after.get(beam.endNodeId);
    const oldLength = a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
    const newLength = c && d ? Math.hypot(c.x - d.x, c.y - d.y, c.z - d.z) : oldLength;
    return [beam.id, oldLength > 1e-9 ? newLength / oldLength : 1] as const;
  }));
  return {
    ...model,
    nodes,
    ...(model.memberLoads ? { memberLoads: model.memberLoads.map((load) => ({ ...load,
      startPositionM: load.startPositionM * (scaleByBeam.get(load.beamId) ?? 1),
      endPositionM: load.endPositionM * (scaleByBeam.get(load.beamId) ?? 1),
    })) } : {}),
    ...(model.memberPointLoads ? { memberPointLoads: model.memberPointLoads.map((load) => ({ ...load,
      positionM: load.positionM * (scaleByBeam.get(load.beamId) ?? 1),
    })) } : {}),
  };
}
