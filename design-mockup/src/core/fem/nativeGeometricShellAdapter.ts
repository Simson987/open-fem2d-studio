import type { Mesh } from './Mesh';
import {
  buildNativeHybridPlateRequest,
  type NativeEdgeLoad,
  type NativeModulusCurve,
  type NativeQuadPressure,
  type NativeReinforcementSpec,
} from './nativePlate2DAdapter';

/** Existing four-node plate mesh -> coupled Rust shallow-shell input. */
export function buildNativeGeometricShellRequest(
  mesh: Mesh,
  pressureKnM2 = 0,
  modulusCurves: readonly NativeModulusCurve[] = [],
  loadPath: readonly number[] = [],
  reinforcement?: NativeReinforcementSpec,
  quadPressures: readonly NativeQuadPressure[] = [],
  edgeLoads: readonly NativeEdgeLoad[] = [],
  membraneSupports: Array<{
    nodeId: number; u?: boolean; v?: boolean; kuKnPerM?: number; kvKnPerM?: number;
  }> = [],
  membraneLoads: Array<{ nodeId: number; fxKn: number; fyKn: number }> = [],
) {
  const bending = buildNativeHybridPlateRequest(
    mesh, pressureKnM2, modulusCurves, loadPath, reinforcement, quadPressures, edgeLoads,
  );

  // The membrane fields are supplied separately from the bending mesh. Check
  // their node references and spring definitions here so malformed app input
  // cannot be silently combined or fail only after crossing the solver API.
  const shellNodeIds = new Set(bending.nodes.map((node) => node.id));
  const supportedNodeIds = new Set<number>();
  if (!Array.isArray(membraneSupports) || membraneSupports.some((support) =>
    support === null || typeof support !== 'object' || Array.isArray(support))) {
    throw new Error('Membraansteunen moeten geldige steunrecords zijn.');
  }
  for (const support of membraneSupports) {
    if ((support.u !== undefined && typeof support.u !== 'boolean')
        || (support.v !== undefined && typeof support.v !== 'boolean')) {
      throw new Error(`Membraansteun op knoop ${support.nodeId} moet vaste richtingen als waar/onwaar bevatten.`);
    }
    if (!shellNodeIds.has(support.nodeId)) {
      throw new Error(`Membraansteun knoop ${support.nodeId} ligt buiten het shellrooster.`);
    }
    if (supportedNodeIds.has(support.nodeId)) {
      throw new Error(`Membraansteun voor knoop ${support.nodeId} is dubbel opgegeven.`);
    }
    supportedNodeIds.add(support.nodeId);
    for (const [axis, fixed, stiffness] of [
      ['u', support.u, support.kuKnPerM],
      ['v', support.v, support.kvKnPerM],
    ] as const) {
      if (stiffness != null && (!Number.isFinite(stiffness) || stiffness <= 0)) {
        throw new Error(`Membraanveer ${axis} op knoop ${support.nodeId} moet eindig en positief zijn.`);
      }
      if (fixed && stiffness != null) {
        throw new Error(`Membraansteun ${axis} op knoop ${support.nodeId} kan niet vast én verend zijn.`);
      }
    }
  }
  if (!Array.isArray(membraneLoads) || membraneLoads.some((load) =>
    load === null || typeof load !== 'object' || Array.isArray(load))) {
    throw new Error('Membraanlasten moeten geldige lastrecords zijn.');
  }
  for (const load of membraneLoads) {
    if (!shellNodeIds.has(load.nodeId)) {
      throw new Error(`Membraanlast knoop ${load.nodeId} ligt buiten het shellrooster.`);
    }
    if (!Number.isFinite(load.fxKn) || !Number.isFinite(load.fyKn)) {
      throw new Error(`Membraanlast op knoop ${load.nodeId} moet eindige krachten bevatten.`);
    }
  }

  return { bending, membraneSupports, membraneLoads };
}
