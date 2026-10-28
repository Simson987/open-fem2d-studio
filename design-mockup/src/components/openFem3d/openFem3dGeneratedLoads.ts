import type { LoadCase } from "../fem/femTypes";
import {
  openFem3DLoadPanelForcePerArea, openFem3DLoadPanelGeometry,
} from "./openFem3dLoadPanels";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import { parseOpenFem3DModel, type OpenFem3DLoadPanel, type OpenFem3DModel } from "./openFem3dModel";
import type { FacadeWindGeneration, FacadeWindLoadPlan } from "./openFem3dFacadeWindLoads";
import type { Nbc2025EnvelopeWindLoad, Nbc2025EnvelopeWindPlan } from "./openFem3dNbc2025Wind";
import type { RoofLoadGeneration, RoofLoadPlan } from "./openFem3dRoofLoads";
import type { EnvelopePoint3 } from "./openFem3dEnvelopeZones";
import type { AfleidingsRegel } from "../../lib/wind/windEurocode";

export interface GeneratedEnvelopeLoadResult {
  model: OpenFem3DModel;
  loadCases: LoadCase[];
  changed: boolean;
  generatedCaseIds: number[];
  generatedPanelIds: number[];
}

function referencedWithoutGeneratedLoads(model: OpenFem3DModel): Set<number> {
  const used = new Set<number>();
  const add = (ids: readonly number[]) => ids.forEach((id) => used.add(id));
  for (const beam of model.beams) add([beam.startNodeId, beam.endNodeId]);
  for (const support of model.supports ?? []) used.add(support.nodeId);
  for (const load of model.loads ?? []) used.add(load.nodeId);
  for (const plate of model.plates ?? []) {
    add(plate.nodeIds);
    for (const opening of plate.openings ?? []) add(opening.nodeIds);
  }
  for (const panel of model.envelopePanels ?? []) {
    add(panel.nodeIds);
    for (const opening of panel.openings ?? []) add(opening.nodeIds);
  }
  for (const panel of model.loadPanels ?? []) if (!panel.generated) {
    add(panel.nodeIds);
    for (const opening of panel.openings ?? []) add(opening.nodeIds);
  }
  for (const diaphragm of model.diaphragms ?? []) add(diaphragm.nodeIds);
  return used;
}

const coordinateKey = (point: EnvelopePoint3) => point.map((value) => value.toFixed(8)).join(":");

function nbcPressureLines(load: Nbc2025EnvelopeWindLoad): AfleidingsRegel[] {
  const p = load.pressureDerivation;
  const heights = load.referenceHeights;
  const line = (symbool: string, value: number, bron: string): AfleidingsRegel =>
    ({ symbool, waarde: String(value), bron });
  return [
    line("q (1/500)", p.referencePressureKPa, p.referencePressureSource),
    line("I_w", p.importanceFactor, p.source),
    line("h_e (m)", p.externalReferenceHeightM, heights.source),
    line("h_i (m)", p.internalReferenceHeightM, heights.source),
    line("C_e", p.externalExposureFactor, p.source),
    line("C_ei", p.internalExposureFactor, p.source),
    line("C_t", p.topographicFactor, p.topographicFactorSource),
    line("C_g", p.externalGustFactor, p.source),
    line("C_gi", p.internalGustFactor, p.internalGustFactorSource),
    line("C_p", p.externalPressureCoefficient, p.externalCoefficientSource),
    line("C_pi", p.internalPressureCoefficient, p.internalCoefficientSource),
    line("p_e (kN/m²)", p.externalPressureKPa, p.source),
    line("p_i (kN/m²)", p.internalPressureKPa, p.source),
    line("p_net (kN/m²)", p.netPressureKPa, p.source),
  ];
}

/**
 * Zet geometrische load-plans in echte 3D-belastingvlakken en gedeelde
 * belastinggevallen om. Alleen `gegenereerd.bron=envelope3d` en vlakken met
 * `generated.source=envelope3d` worden vervangen; handwerk blijft staan.
 */
export function applyGeneratedEnvelopeLoads(
  model: OpenFem3DModel, loadCases: readonly LoadCase[],
  wind: FacadeWindGeneration | Nbc2025EnvelopeWindPlan | null, roof: RoofLoadGeneration,
): GeneratedEnvelopeLoadResult {
  if ((wind?.windCodeId === "ca-nbc-2025" && roof.codeId !== "ca-nbc-2025"
    && (roof.cases.length > 0 || roof.loads.length > 0))
    || (roof.codeId === "ca-nbc-2025" && wind?.windCodeId !== "ca-nbc-2025")) {
    throw new Error("NBC 2025-wind kan niet met Nederlandse daklastgevallen worden gemengd.");
  }
  const plans = [...(wind?.loads ?? []), ...roof.loads] as
    (FacadeWindLoadPlan | Nbc2025EnvelopeWindLoad | RoofLoadPlan)[];
  const casePlans = [
    ...(wind?.cases ?? []).map((entry) => ({ key: entry.key,
      name: "name" in entry ? entry.name
        : `Wind ${entry.direction}, NBC 2025 ${entry.limitState.toUpperCase()}, C_pi = ${entry.internalPressureCoefficient}`,
      type: "wind" as const })),
    ...roof.cases,
  ];
  const caseKeys = new Set<string>();
  for (const item of casePlans) {
    if (caseKeys.has(item.key)) throw new Error(`Dubbel gegenereerd belastinggeval ${item.key}.`);
    caseKeys.add(item.key);
  }
  const oldCases = new Map(loadCases.filter((item) => item.gegenereerd?.bron === "envelope3d")
    .map((item) => [item.gegenereerd!.sleutel, item.id]));
  let nextCaseId = Math.max(0, ...loadCases.map((item) => item.id)) + 1;
  const caseIds = new Map<string, number>();
  const generatedCases: LoadCase[] = casePlans.map((item) => {
    const id = oldCases.get(item.key) ?? nextCaseId++;
    caseIds.set(item.key, id);
    return { id, name: item.name, type: item.type,
      gegenereerd: { bron: "envelope3d", sleutel: item.key,
        ...(item.type === "wind" ? { windCodeId: wind!.windCodeId }
          : roof.codeId ? { windCodeId: roof.codeId } : {}) } };
  });

  const oldPanels = new Map((model.loadPanels ?? []).filter((panel) => panel.generated?.source === "envelope3d")
    .map((panel) => [panel.generated!.key, panel.id]));
  let nextPanelId = Math.max(0, ...(model.loadPanels ?? []).map((panel) => panel.id)) + 1;
  let nextNodeId = Math.max(0, ...model.nodes.map((node) => node.id)) + 1;
  const nodes = model.nodes.slice();
  const helperIds = new Set(model.generatedNodeIds ?? []);
  const nodeByCoordinate = new Map<string, number>();
  for (const node of nodes) {
    const key = coordinateKey([node.x, node.y, node.z]);
    if (!nodeByCoordinate.has(key)) nodeByCoordinate.set(key, node.id);
  }
  const idFor = (point: EnvelopePoint3) => {
    const key = coordinateKey(point);
    const existing = nodeByCoordinate.get(key);
    if (existing !== undefined) return existing;
    const id = nextNodeId++;
    nodes.push({ id, x: point[0], y: point[1], z: point[2] });
    nodeByCoordinate.set(key, id);
    helperIds.add(id);
    return id;
  };
  const envelopeById = new Map((model.envelopePanels ?? []).map((panel) => [panel.id, panel]));
  const seenPlanKeys = new Set<string>();
  const generatedPanels: OpenFem3DLoadPanel[] = plans.map((plan) => {
    if (seenPlanKeys.has(plan.key)) throw new Error(`Dubbel gegenereerd belastingvlak ${plan.key}.`);
    seenPlanKeys.add(plan.key);
    const envelope = envelopeById.get(plan.panelId);
    if (!envelope) throw new Error(`Schilpaneel ${plan.panelId} bestaat niet meer.`);
    const caseId = caseIds.get(plan.caseKey);
    if (caseId === undefined) throw new Error(`Belastinggeval ${plan.caseKey} ontbreekt.`);
    const id = oldPanels.get(plan.key) ?? nextPanelId++;
    const nodeIds = plan.triangle.points.map(idFor);
    const windPlan = "qOutwardKnPerM2" in plan ? plan : null;
    const nbcPlan = windPlan && "pressurePlan" in windPlan ? windPlan : null;
    const enPlan = windPlan && !nbcPlan ? windPlan as FacadeWindLoadPlan : null;
    const outward = windPlan ? openFem3DEnvelopePanelGeometry(model, envelope).outwardNormal : null;
    const canonical = windPlan ? openFem3DEnvelopePanelGeometry(model, envelope).outer.normal : null;
    const orientation = outward && canonical
      ? Math.sign(outward[0] * canonical[0] + outward[1] * canonical[1] + outward[2] * canonical[2]) : 1;
    return {
      id, nodeIds, caseId,
      q: windPlan ? windPlan.qOutwardKnPerM2 * orientation : (plan as RoofLoadPlan).q,
      direction: windPlan ? "normal" : (plan as RoofLoadPlan).direction,
      distribution: envelope.distribution,
      ...(envelope.spanDirection ? { spanDirection: envelope.spanDirection } : {}),
      generated: {
        source: "envelope3d", key: plan.key, panelId: plan.panelId, zone: plan.zone,
        coefficient: nbcPlan ? nbcPlan.pressureDerivation.externalPressureCoefficient
          : enPlan ? enPlan.cpe : (plan as RoofLoadPlan).coefficient,
        referencePressureKnPerM2: nbcPlan ? nbcPlan.pressureDerivation.referencePressureKPa
          : enPlan ? enPlan.qpKnPerM2 : (plan as RoofLoadPlan).referencePressureKnPerM2,
        ...(windPlan ? { internalPressureCoefficient: nbcPlan
          ? nbcPlan.pressureDerivation.internalPressureCoefficient : enPlan!.cpi } : {}),
        ...(nbcPlan ? { windInternalPressureDerivation: [
          { symbool: "C_pi", waarde: String(nbcPlan.pressureDerivation.internalPressureCoefficient),
            bron: nbcPlan.pressureDerivation.internalCoefficientSource },
          { symbool: "C_gi", waarde: String(nbcPlan.pressureDerivation.internalGustFactor),
            bron: nbcPlan.pressureDerivation.internalGustFactorSource },
        ] } : enPlan ? { windInternalPressureDerivation: enPlan.internalPressureDerivation
          .map((line) => ({ ...line })) } : {}),
        ...(windPlan ? { windCodeId: wind!.windCodeId }
          : roof.codeId ? { windCodeId: roof.codeId } : {}),
        ...(enPlan ? { windStructuralFactor: enPlan.structuralFactor } : {}),
        ...(nbcPlan ? { windReferenceHeightM: nbcPlan.pressureDerivation.externalReferenceHeightM,
          windPressureMethod: "nbc-static" as const, windPressureDerivation: nbcPressureLines(nbcPlan),
          windPressurePlan: nbcPlan.pressurePlan }
          : enPlan ? { windReferenceHeightM: enPlan.referenceHeightM,
            windPressureMethod: enPlan.pressureMethod,
            windPressureDerivation: enPlan.pressureDerivation.map((line) => ({ ...line })) } : {}),
        sourceReference: nbcPlan ? nbcPlan.pressurePlan.source : (plan as FacadeWindLoadPlan | RoofLoadPlan).sourceReference,
      },
    };
  });
  const used = referencedWithoutGeneratedLoads(model);
  for (const panel of generatedPanels) panel.nodeIds.forEach((id) => used.add(id));
  const retainedNodes = nodes.filter((node) => !helperIds.has(node.id) || used.has(node.id));
  const retainedHelpers = retainedNodes.filter((node) => helperIds.has(node.id)).map((node) => node.id);
  const candidate = parseOpenFem3DModel({ ...model,
    nodes: retainedNodes,
    generatedNodeIds: retainedHelpers,
    loadPanels: [...(model.loadPanels ?? []).filter((panel) => !panel.generated), ...generatedPanels],
  });
  for (const panel of generatedPanels) {
    const geometry = openFem3DLoadPanelGeometry(candidate, panel);
    openFem3DLoadPanelForcePerArea(panel, geometry);
  }
  const nextCases = [...loadCases.filter((item) => item.gegenereerd?.bron !== "envelope3d"), ...generatedCases];
  if (JSON.stringify(candidate) === JSON.stringify(model) && JSON.stringify(nextCases) === JSON.stringify(loadCases)) {
    return { model, loadCases: loadCases as LoadCase[], changed: false,
      generatedCaseIds: generatedCases.map((item) => item.id), generatedPanelIds: generatedPanels.map((item) => item.id) };
  }
  return { model: candidate, loadCases: nextCases, changed: true,
    generatedCaseIds: generatedCases.map((item) => item.id), generatedPanelIds: generatedPanels.map((item) => item.id) };
}
