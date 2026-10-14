import type { Nbc2025HorizontalWindAction } from "../../lib/wind/nbc2025PartialWind";
import type { LoadCase } from "../fem/femTypes";
import { parseOpenFem3DModel, type OpenFem3DModel, type OpenFem3DNodalLoadComponents } from "./openFem3dModel";
import type { Nbc2025EnvelopeWindPlan } from "./openFem3dNbc2025Wind";

export interface Nbc2025WindTransferLevel {
  /** Existing structural nodes at one elevation. */
  nodeIds: number[];
  /** A diaphragm transfers floor shear; supported-base nodes receive wall reactions. */
  kind: "diaphragm" | "supported-base";
  /** Project evidence for the chosen wind transfer path. */
  source: string;
}

export interface Nbc2025TransferredWindCase {
  key: string;
  name: string;
  action: Nbc2025HorizontalWindAction;
  transferSource: string;
  loads: (OpenFem3DNodalLoadComponents & { nodeId: number })[];
}

type Level = Nbc2025WindTransferLevel & { z: number; nodes: { id: number; x: number; y: number }[] };
type LevelForce = { fx: number; fy: number; mz: number };
const EPS = 1e-8;
const close = (a: number, b: number) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(b));

/**
 * Transfer main-system partial wind to verified rigid floor diaphragms and
 * supported base nodes. Linear vertical interpolation preserves the exact
 * force height of each loaded facade triangle; in-plane nodal force couples
 * preserve its torsion. This is a global lateral-system transfer, not a
 * cladding or local wall-member design load.
 */
export function nbc2025TransferPartialWind(
  model: OpenFem3DModel, wind: Nbc2025EnvelopeWindPlan,
  actions: readonly Nbc2025HorizontalWindAction[], levelsInput: readonly Nbc2025WindTransferLevel[],
): Nbc2025TransferredWindCase[] {
  if (levelsInput.length < 2) throw new Error("NBC-deelwind vraagt minstens twee overdrachtsniveaus.");
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const structural = new Set(model.beams.flatMap((beam) => [beam.startNodeId, beam.endNodeId]));
  for (const plate of model.plates ?? []) plate.nodeIds.forEach((id) => structural.add(id));
  const supports = new Map((model.supports ?? []).map((support) => [support.nodeId, support]));
  const seenNodes = new Set<number>();
  const levels: Level[] = levelsInput.map((level) => {
    if (typeof level.source !== "string" || !level.source.trim()
      || !Array.isArray(level.nodeIds) || level.nodeIds.length < 2
      || new Set(level.nodeIds).size !== level.nodeIds.length) {
      throw new Error("NBC-overdrachtsniveau vraagt een bron en minstens twee unieke knopen.");
    }
    const nodes = level.nodeIds.map((id) => {
      const node = nodeById.get(id);
      if (!node || !structural.has(id) || seenNodes.has(id)) {
        throw new Error(`NBC-overdrachtsknoop ${id} ontbreekt, is niet constructief of is dubbel.`);
      }
      seenNodes.add(id);
      return node;
    });
    const z = nodes[0].z;
    if (nodes.some((node) => Math.abs(node.z - z) > EPS)) {
      throw new Error("NBC-overdrachtsknopen moeten per niveau op één hoogte liggen.");
    }
    if (level.kind === "diaphragm") {
      if (!(model.diaphragms ?? []).some((item) => item.nodeIds.length === level.nodeIds.length
        && item.nodeIds.every((id) => level.nodeIds.includes(id)))) {
        throw new Error("NBC-overdrachtsniveau verwijst niet naar een volledige bestaande starre schijf.");
      }
    } else if (level.kind === "supported-base") {
      if (!level.nodeIds.every((id) => supports.has(id))) {
        throw new Error("NBC-basisniveau vraagt opleggingen op alle overdrachtsknopen.");
      }
      if (!level.nodeIds.every((id) => {
        const support = supports.get(id)!;
        return (support.ux || (support.springs?.kxKnPerM ?? 0) > 0)
          && (support.uy || (support.springs?.kyKnPerM ?? 0) > 0);
      })) {
        throw new Error("NBC-basisniveau vraagt op elke overdrachtsknoop horizontale oplegging in X en Y.");
      }
    } else {
      throw new Error("NBC-overdrachtsniveau heeft een onbekend type.");
    }
    const xMean = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
    const yMean = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
    if (nodes.reduce((sum, node) => sum + (node.x - xMean) ** 2 + (node.y - yMean) ** 2, 0) < EPS) {
      throw new Error("NBC-overdrachtsniveau heeft geen arm voor torsie.");
    }
    return { ...level, z, nodes };
  });
  if (levels.some((level, index) => index > 0 && level.z - levels[index - 1].z <= 1e-3)
    || levels.filter((level) => level.kind === "supported-base").length !== 1
    || levels[0].kind !== "supported-base") {
    throw new Error("NBC-overdrachtsniveaus moeten oplopen vanaf één ondersteund basisniveau.");
  }
  const shell = (model.envelopePanels ?? []).flatMap((panel) => panel.nodeIds.map((id) => nodeById.get(id)));
  if (!shell.length || shell.some((node) => !node)) throw new Error("NBC-deelwind mist geldige gebouwschilknopen.");
  const centerX = (Math.min(...shell.map((node) => node!.x)) + Math.max(...shell.map((node) => node!.x))) / 2;
  const centerY = (Math.min(...shell.map((node) => node!.y)) + Math.max(...shell.map((node) => node!.y))) / 2;
  const cases = new Map(wind.cases.map((item) => [item.key, item]));
  const loadsByCase = new Map(wind.cases.map((item) => [item.key, wind.loads.filter((load) => load.caseKey === item.key)]));
  const generated: Nbc2025TransferredWindCase[] = [];
  for (const action of actions.filter((item) => item.pattern !== "a")) {
    const scale = action.pattern === "d" ? 0.56 : 0.75;
    const levelForces: LevelForce[] = levels.map(() => ({ fx: 0, fy: 0, mz: 0 }));
    for (const key of action.pressureCaseKeys) {
      const windCase = cases.get(key);
      if (!windCase || windCase.limitState !== action.limitState
        || windCase.internalPressureCoefficient !== action.internalPressureCoefficient) {
        throw new Error("NBC-deelwind verwijst naar een ongeldig winddrukgeval.");
      }
      for (const load of loadsByCase.get(key) ?? []) {
        const patch = windCase.patches.find((item) => item.pressurePlan.surfaceId === load.surfaceId);
        if (!patch) throw new Error("NBC-deelwind mist een drukvlak.");
        const fx = scale * load.qOutwardKnPerM2 * load.triangle.areaM2 * patch.outwardNormal[0];
        const fy = scale * load.qOutwardKnPerM2 * load.triangle.areaM2 * patch.outwardNormal[1];
        if (Math.abs(fx) + Math.abs(fy) < 1e-14) continue;
        const [x, y, z] = [0, 1, 2].map((axis) => load.triangle.points
          .reduce((sum, point) => sum + point[axis], 0) / 3);
        if (z < levels[0].z - EPS || z > levels[levels.length - 1].z + EPS) {
          throw new Error("NBC-deelwind heeft geveldruk buiten de opgegeven overdrachtsniveaus.");
        }
        const upper = Math.max(1, levels.findIndex((level) => level.z >= z - EPS));
        const lower = upper - 1;
        const upperWeight = Math.max(0, Math.min(1, (z - levels[lower].z) / (levels[upper].z - levels[lower].z)));
        for (const [index, weight] of [[lower, 1 - upperWeight], [upper, upperWeight]] as const) {
          levelForces[index].fx += weight * fx;
          levelForces[index].fy += weight * fy;
          levelForces[index].mz += weight * ((x - centerX + action.offsetXM) * fy
            - (y - centerY + action.offsetYM) * fx);
        }
      }
    }
    const loads: Nbc2025TransferredWindCase["loads"] = [];
    for (const [index, level] of levels.entries()) {
      const { fx, fy, mz } = levelForces[index];
      const xMean = level.nodes.reduce((sum, node) => sum + node.x, 0) / level.nodes.length;
      const yMean = level.nodes.reduce((sum, node) => sum + node.y, 0) / level.nodes.length;
      const spread = level.nodes.reduce((sum, node) => sum + (node.x - xMean) ** 2 + (node.y - yMean) ** 2, 0);
      const localTorsion = mz + (centerX - xMean) * fy - (centerY - yMean) * fx;
      for (const node of level.nodes) {
        const nodeFx = fx / level.nodes.length - localTorsion * (node.y - yMean) / spread;
        const nodeFy = fy / level.nodes.length + localTorsion * (node.x - xMean) / spread;
        if (Math.abs(nodeFx) + Math.abs(nodeFy) < 1e-14) continue;
        loads.push({ nodeId: node.id, fx: nodeFx, fy: nodeFy, fz: 0, mx: 0, my: 0, mz: 0 });
      }
    }
    const total = loads.reduce((sum, load) => {
      const node = nodeById.get(load.nodeId)!;
      const z = node.z - levels[0].z;
      return { fx: sum.fx + load.fx, fy: sum.fy + load.fy,
        mx: sum.mx - z * load.fy, my: sum.my + z * load.fx,
        mz: sum.mz + (node.x - centerX) * load.fy - (node.y - centerY) * load.fx };
    }, { fx: 0, fy: 0, mx: 0, my: 0, mz: 0 });
    if (!close(total.fx, action.fxKn) || !close(total.fy, action.fyKn)
      || !close(total.mx, action.baseMxKnM) || !close(total.my, action.baseMyKnM)
      || !close(total.mz, action.mzKnM)) {
      throw new Error("NBC-deelwind verliest kracht of moment bij overdracht naar de constructie.");
    }
    const key = `nbc2025:partial:${action.limitState}:${action.pattern}:${action.pressureCaseKeys.join("|")}:offset:${action.offsetXM}:${action.offsetYM}`;
    generated.push({ key, name: `NBC 2025 ${action.limitState.toUpperCase()} §4.1.7.9(${action.pattern}) ${action.pressureCaseKeys.join(" + ")} Δx=${action.offsetXM}m Δy=${action.offsetYM}m`,
      action, transferSource: levels.map((level) => level.source).join("; "), loads });
  }
  if (new Set(generated.map((item) => item.key)).size !== generated.length) {
    throw new Error("NBC-deelwind heeft dubbele belastinggevalsleutels.");
  }
  return generated;
}

/** Replace only the generated partial-wind nodal loads and their cases. */
export function applyNbc2025TransferredWindCases(
  model: OpenFem3DModel, loadCases: readonly LoadCase[], plans: readonly Nbc2025TransferredWindCase[],
  previousPartialCases: readonly LoadCase[] = [],
): { model: OpenFem3DModel; loadCases: LoadCase[]; changed: boolean;
  caseIds: number[]; loadIds: number[] } {
  if (new Set(plans.map((item) => item.key)).size !== plans.length
    || plans.some((item) => !item.key.startsWith("nbc2025:partial:"))) {
    throw new Error("NBC-deelwind bevat dubbele belastinggevalsleutels.");
  }
  const oldCases = new Map(previousPartialCases.filter((item) => item.gegenereerd?.sleutel.startsWith("nbc2025:partial:"))
    .map((item) => [item.gegenereerd!.sleutel, item.id]));
  if (oldCases.size !== previousPartialCases.filter((item) =>
    item.gegenereerd?.sleutel.startsWith("nbc2025:partial:")).length) {
    throw new Error("NBC-deelwind bevat dubbele oude belastinggevalsleutels.");
  }
  const oldLoads = new Map((model.loads ?? []).filter((item) => item.generated?.source === "nbc2025-partial-wind")
    .map((item) => [item.generated!.key, item.id]));
  if (oldLoads.size !== (model.loads ?? []).filter((item) =>
    item.generated?.source === "nbc2025-partial-wind").length) {
    throw new Error("NBC-deelwind bevat dubbele oude knooplastsleutels.");
  }
  let nextCaseId = Math.max(0, ...loadCases.map((item) => item.id), ...previousPartialCases.map((item) => item.id)) + 1;
  let nextLoadId = Math.max(0, ...(model.loads ?? []).map((item) => item.id)) + 1;
  const retainedCases = loadCases.filter((item) => !item.gegenereerd?.sleutel.startsWith("nbc2025:partial:"));
  const retainedLoads = (model.loads ?? []).filter((item) => item.generated?.source !== "nbc2025-partial-wind");
  const generatedCases: LoadCase[] = [];
  const generatedLoads: NonNullable<OpenFem3DModel["loads"]> = [];
  const usedCaseIds = new Set(retainedCases.map((item) => item.id));
  const usedLoadIds = new Set(retainedLoads.map((item) => item.id));
  for (const plan of plans) {
    const reused = oldCases.get(plan.key);
    const caseId = reused !== undefined && !usedCaseIds.has(reused) ? reused : nextCaseId++;
    usedCaseIds.add(caseId);
    generatedCases.push({ id: caseId, name: plan.name, type: "wind",
      gegenereerd: { bron: "envelope3d", sleutel: plan.key, windCodeId: "ca-nbc-2025" } });
    for (const load of plan.loads) {
      const key = `${plan.key}:node:${load.nodeId}`;
      const reusedLoad = oldLoads.get(key);
      const id = reusedLoad !== undefined && !usedLoadIds.has(reusedLoad) ? reusedLoad : nextLoadId++;
      usedLoadIds.add(id);
      generatedLoads.push({ id, caseId, ...load,
        generated: { source: "nbc2025-partial-wind", key,
          sourceReference: `${plan.action.source}; transfer: ${plan.transferSource}` } });
    }
  }
  const candidate = parseOpenFem3DModel({ ...model, loads: [...retainedLoads, ...generatedLoads] });
  const nextCases = [...retainedCases, ...generatedCases];
  const changed = JSON.stringify(candidate) !== JSON.stringify(model)
    || JSON.stringify(nextCases) !== JSON.stringify(loadCases);
  return { model: changed ? candidate : model, loadCases: changed ? nextCases : loadCases as LoadCase[],
    changed, caseIds: generatedCases.map((item) => item.id), loadIds: generatedLoads.map((item) => item.id) };
}
