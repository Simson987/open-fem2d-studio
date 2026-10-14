import {
  nbc2025FlatRoofSnowPressure, type Nbc2025FlatRoofSnowInput,
} from "../../lib/wind/nbc2025Snow";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import {
  clipOpenFem3DEnvelopeTriangle, triangulateOpenFem3DEnvelopePanel,
  type EnvelopeZoneTriangle,
} from "./openFem3dEnvelopeZones";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { RoofLoadGeneration, RoofLoadPlan } from "./openFem3dRoofLoads";

export interface Nbc2025SnowPartition {
  axis: "x" | "y";
  /** Distance from the minimum X or Y edge of the rectangular roof, in m. */
  atM: number;
  fullLoadSide: "lower" | "upper";
  source: string;
}

export interface Nbc2025SnowPanelInput extends Nbc2025FlatRoofSnowInput {
  /** Each selected critical partition uses S on one side and 0.5S on the rest. */
  partitions: readonly Nbc2025SnowPartition[];
  partialRegionsVerifiedForMembers: true;
  partialRegionsSource: string;
}

export interface Nbc2025SnowPanelPlan extends RoofLoadGeneration {
  codeId: "ca-nbc-2025";
  caseKeyPairs: { uls: string; sls: string }[];
}

/** Project-supplied critical partitions; this does not choose them for the user. */
export function generateNbc2025FlatRoofSnowPanels(
  model: OpenFem3DModel, input: Nbc2025SnowPanelInput,
): Nbc2025SnowPanelPlan {
  if (input.partialRegionsVerifiedForMembers !== true || !input.partialRegionsSource?.trim()
    || !Array.isArray(input.partitions) || input.partitions.length === 0) {
    throw new Error("NBC-sneeuw vraagt onderbouwde gedeeltelijke verdelingen voor de maatgevende constructiedelen.");
  }
  const panels = (model.envelopePanels ?? []).filter((panel) => panel.type === "roof");
  if (panels.length !== 1) throw new Error("Dit NBC-sneeuwplan vraagt één volledig rechthoekig plat dakpaneel.");
  const panel = panels[0];
  const geometry = openFem3DEnvelopePanelGeometry(model, panel);
  const roofNodes = panel.nodeIds.map((id) => model.nodes.find((node) => node.id === id));
  if (roofNodes.some((node) => !node)) throw new Error("NBC-dakpaneel verwijst naar een ontbrekende knoop.");
  const x0 = Math.min(...roofNodes.map((node) => node!.x));
  const x1 = Math.max(...roofNodes.map((node) => node!.x));
  const y0 = Math.min(...roofNodes.map((node) => node!.y));
  const y1 = Math.max(...roofNodes.map((node) => node!.y));
  const z0 = Math.min(...roofNodes.map((node) => node!.z));
  const z1 = Math.max(...roofNodes.map((node) => node!.z));
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, input.widthXM * input.widthYM);
  if (!close(x1 - x0, input.widthXM) || !close(y1 - y0, input.widthYM)
    || !close(z0, z1) || !close(geometry.outer.areaM2, input.widthXM * input.widthYM)
    || geometry.outwardNormal[2] < 1 - 1e-7) {
    throw new Error("NBC-sneeuw vraagt een volledig rechthoekig horizontaal dak met buitenzijde omhoog.");
  }
  const uls = nbc2025FlatRoofSnowPressure(input, "uls");
  const sls = nbc2025FlatRoofSnowPressure(input, "sls");
  const triangles = triangulateOpenFem3DEnvelopePanel(model, panel);
  const seen = new Set<string>();
  for (const partition of input.partitions) {
    const dimension = partition.axis === "x" ? input.widthXM : partition.axis === "y" ? input.widthYM : NaN;
    if (!Number.isFinite(partition.atM) || partition.atM <= 0 || partition.atM >= dimension
      || (partition.fullLoadSide !== "lower" && partition.fullLoadSide !== "upper")
      || !partition.source?.trim()) {
      throw new Error("NBC-sneeuwverdeling vraagt een onderbouwde snede binnen het dakvlak.");
    }
    const key = `${partition.axis}:${partition.atM}:${partition.fullLoadSide}`;
    if (seen.has(key)) throw new Error("Dubbele NBC-sneeuwverdeling.");
    seen.add(key);
  }
  const cases: RoofLoadGeneration["cases"] = [];
  const loads: RoofLoadPlan[] = [];
  const caseKeyPairs: Nbc2025SnowPanelPlan["caseKeyPairs"] = [];
  const add = (key: string, zone: string, pressureKPa: number,
    coefficient: number, pieces: readonly EnvelopeZoneTriangle[], sourceReference: string) => {
    pieces.forEach((triangle, index) => loads.push({
      key: `${key}:panel:${panel.id}:zone:${zone}:piece:${index}`, caseKey: key,
      panelId: panel.id, zone, q: pressureKPa * coefficient, direction: "gravity",
      coefficient, referencePressureKnPerM2: pressureKPa, sourceReference, triangle,
    }));
  };
  for (const [state, pressure] of [["uls", uls], ["sls", sls]] as const) {
    const derivation = `${pressure.source}; S_s=${input.groundSnowKPa} kPa [${input.groundSnowSource}]; `
      + `S_r=${input.associatedRainKPa} kPa [${input.associatedRainSource}]; `
      + `C_b=${pressure.basicRoofFactor}; C_w=${input.windExposureFactor} [${input.windExposureSource}]; `
      + `C_s=1; C_a=1 [${input.accumulationEvidenceSource}]; `
      + `C_T=${input.thermalFactor} [${input.thermalFactorSource}]; I_s=${pressure.importanceFactor}`;
    const uniformKey = `nbc2025:snow:${state}:uniform`;
    cases.push({ key: uniformKey, name: `NBC 2025 sneeuw ${state.toUpperCase()} volledig`, type: "snow" });
    add(uniformKey, "uniform", pressure.pressureKPa, 1, triangles, derivation);
    for (const partition of input.partitions) {
      const key = `nbc2025:snow:${state}:partial:${partition.axis}:${partition.atM}:${partition.fullLoadSide}`;
      cases.push({ key, name: `NBC 2025 sneeuw ${state.toUpperCase()} ${partition.axis} ${partition.atM} m ${partition.fullLoadSide}`,
        type: "snow" });
      const axis = partition.axis === "x" ? 0 : 1;
      const cut = (axis === 0 ? x0 : y0) + partition.atM;
      const first = triangles.flatMap((triangle) => clipOpenFem3DEnvelopeTriangle(triangle, axis, -Infinity, cut));
      const second = triangles.flatMap((triangle) => clipOpenFem3DEnvelopeTriangle(triangle, axis, cut, Infinity));
      const firstFactor = partition.fullLoadSide === "lower" ? 1 : 0.5;
      add(key, "lower", pressure.pressureKPa, firstFactor, first,
        `${derivation}; gedeeltelijke verdeling: ${partition.source}; ${input.partialRegionsSource}`);
      add(key, "upper", pressure.pressureKPa, partition.fullLoadSide === "upper" ? 1 : 0.5,
        second, `${derivation}; gedeeltelijke verdeling: ${partition.source}; ${input.partialRegionsSource}`);
    }
  }
  for (let index = 0; index <= input.partitions.length; index += 1) {
    caseKeyPairs.push({ uls: cases[index].key, sls: cases[index + input.partitions.length + 1].key });
  }
  return { roofShape: "flat", codeId: "ca-nbc-2025", cases, loads, warnings: [], caseKeyPairs };
}
