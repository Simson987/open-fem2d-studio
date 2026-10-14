import {
  nbc2025RectangularWindPlan,
  type NbcRectangularWindBuildingInput, type NbcRectangularWindCase, type NbcRectangularWindPlanInput,
  type NbcWindVector,
} from "../../lib/wind/nbc2025RectangularWindPlan";
import type { Nbc2025ReferenceHeights } from "../../lib/wind/nbc2025ReferenceHeights";
import type { Nbc2025StaticPressureResult } from "../../lib/wind/nbc2025StaticWind";
import type { WindSurfacePressurePlan } from "../../lib/wind/windSurfacePressurePlan";
import type { Nbc2025HorizontalCaseResultant } from "../../lib/wind/nbc2025PartialWind";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import {
  clipOpenFem3DEnvelopeTriangle, triangulateOpenFem3DEnvelopePanel,
  type EnvelopeZoneTriangle,
} from "./openFem3dEnvelopeZones";
import type { OpenFem3DEnvelopePanel, OpenFem3DModel } from "./openFem3dModel";

type FaceId = "x-min-wall" | "x-max-wall" | "y-min-wall" | "y-max-wall" | "roof";

export interface Nbc2025EnvelopeWindLoad {
  key: string;
  caseKey: string;
  panelId: number;
  surfaceId: string;
  zone: string;
  qOutwardKnPerM2: number;
  triangle: EnvelopeZoneTriangle;
  pressurePlan: WindSurfacePressurePlan;
  pressureDerivation: Nbc2025StaticPressureResult;
  referenceHeights: Nbc2025ReferenceHeights;
}

export interface Nbc2025EnvelopeWindPlan {
  windCodeId: "ca-nbc-2025";
  cases: NbcRectangularWindCase[];
  loads: Nbc2025EnvelopeWindLoad[];
}

/** Horizontal force and moments of the projected net facade triangles. */
export function nbc2025ProjectedHorizontalResultants(
  model: OpenFem3DModel, plan: Nbc2025EnvelopeWindPlan,
): Map<string, Nbc2025HorizontalCaseResultant> {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const shellNodes = (model.envelopePanels ?? []).flatMap((panel) => panel.nodeIds.map((id) => nodeById.get(id)));
  if (!shellNodes.length || shellNodes.some((node) => !node)) {
    throw new Error("NBC-projectieresultante vraagt geldige gebouwschilknopen.");
  }
  const baseZ = Math.min(...shellNodes.map((node) => node!.z));
  const x0 = Math.min(...shellNodes.map((node) => node!.x));
  const x1 = Math.max(...shellNodes.map((node) => node!.x));
  const y0 = Math.min(...shellNodes.map((node) => node!.y));
  const y1 = Math.max(...shellNodes.map((node) => node!.y));
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;
  const cases = new Map(plan.cases.map((item) => [item.key, item]));
  if (cases.size !== plan.cases.length) throw new Error("NBC-projectieresultante bevat dubbele windgevallen.");
  const result = new Map<string, Nbc2025HorizontalCaseResultant>(plan.cases.map((item) =>
    [item.key, { fxKn: 0, fyKn: 0, baseMxKnM: 0, baseMyKnM: 0, centerMzKnM: 0 }]));
  for (const load of plan.loads) {
    const windCase = cases.get(load.caseKey);
    const patch = windCase?.patches.find((item) => item.pressurePlan.surfaceId === load.surfaceId);
    if (!patch || !Number.isFinite(load.qOutwardKnPerM2)
      || !Number.isFinite(load.triangle.areaM2) || load.triangle.areaM2 <= 0) {
      throw new Error(`NBC-projectieresultante heeft een ongeldig vlak in ${load.caseKey}.`);
    }
    const force = load.qOutwardKnPerM2 * load.triangle.areaM2;
    const fx = force * patch.outwardNormal[0];
    const fy = force * patch.outwardNormal[1];
    const z = load.triangle.points.reduce((sum, point) => sum + point[2], 0) / 3 - baseZ;
    const x = load.triangle.points.reduce((sum, point) => sum + point[0], 0) / 3 - centerX;
    const y = load.triangle.points.reduce((sum, point) => sum + point[1], 0) / 3 - centerY;
    const current = result.get(load.caseKey)!;
    current.fxKn += fx;
    current.fyKn += fy;
    current.baseMxKnM -= z * fy;
    current.baseMyKnM += z * fx;
    current.centerMzKnM += x * fy - y * fx;
  }
  return result;
}

/** Keep ULS and SLS as separate wind cases: their importance factors differ. */
export function generateNbc2025EnvelopeWindLoadsForLimitStates(
  model: OpenFem3DModel, input: NbcRectangularWindBuildingInput,
): Nbc2025EnvelopeWindPlan {
  const uls = generateNbc2025EnvelopeWindLoads(model, { ...input, limitState: "uls" });
  const sls = generateNbc2025EnvelopeWindLoads(model, { ...input, limitState: "sls" });
  return { windCodeId: "ca-nbc-2025", cases: [...uls.cases, ...sls.cases],
    loads: [...uls.loads, ...sls.loads] };
}

const EPS = 1e-7;
const close = (a: number, b: number, scale: number) => Math.abs(a - b) <= EPS * Math.max(1, scale);
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Project the NBC pressure plan onto five full-face rectangular envelope
 * panels. Openings are removed by the shared panel triangulator; incomplete,
 * overlapping or reversed panels are rejected before any load is returned.
 */
export function generateNbc2025EnvelopeWindLoads(
  model: OpenFem3DModel, input: NbcRectangularWindPlanInput,
): Nbc2025EnvelopeWindPlan {
  const cases = nbc2025RectangularWindPlan(input);
  const panels = model.envelopePanels ?? [];
  if (panels.length !== 5 || panels.filter((panel) => panel.type === "facade").length !== 4
    || panels.filter((panel) => panel.type === "roof").length !== 1) {
    throw new Error("NBC-vlakprojectie vraagt vier volledige rechthoekige gevelpanelen en één plat dakpaneel.");
  }
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const corners = panels.flatMap((panel) => panel.nodeIds.map((id) => {
    const node = byId.get(id);
    if (!node) throw new Error(`Schilpaneel ${panel.id} verwijst naar ontbrekende knoop ${id}.`);
    return node;
  }));
  const x0 = Math.min(...corners.map((node) => node.x));
  const x1 = Math.max(...corners.map((node) => node.x));
  const y0 = Math.min(...corners.map((node) => node.y));
  const y1 = Math.max(...corners.map((node) => node.y));
  const z0 = Math.min(...corners.map((node) => node.z));
  const z1 = Math.max(...corners.map((node) => node.z));
  const scale = Math.max(input.widthXM, input.widthYM, input.heightM);
  if (!close(x1 - x0, input.widthXM, scale) || !close(y1 - y0, input.widthYM, scale)
    || !close(z1 - z0, input.heightM, scale)) {
    throw new Error("Schilafmetingen wijken af van de opgegeven NBC-gebouwmaten.");
  }
  const faces: Record<FaceId, { type: "facade" | "roof"; bounds: readonly number[];
    normal: NbcWindVector; area: number }> = {
    "x-min-wall": { type: "facade", bounds: [x0, x0, y0, y1, z0, z1], normal: [-1, 0, 0],
      area: input.widthYM * input.heightM },
    "x-max-wall": { type: "facade", bounds: [x1, x1, y0, y1, z0, z1], normal: [1, 0, 0],
      area: input.widthYM * input.heightM },
    "y-min-wall": { type: "facade", bounds: [x0, x1, y0, y0, z0, z1], normal: [0, -1, 0],
      area: input.widthXM * input.heightM },
    "y-max-wall": { type: "facade", bounds: [x0, x1, y1, y1, z0, z1], normal: [0, 1, 0],
      area: input.widthXM * input.heightM },
    roof: { type: "roof", bounds: [x0, x1, y0, y1, z1, z1], normal: [0, 0, 1],
      area: input.widthXM * input.widthYM },
  };
  const matched = new Map<FaceId, { panel: OpenFem3DEnvelopePanel; triangles: EnvelopeZoneTriangle[];
    netAreaM2: number }>();
  for (const panel of panels) {
    const nodes = panel.nodeIds.map((id) => byId.get(id)!);
    const bounds = [Math.min(...nodes.map((node) => node.x)), Math.max(...nodes.map((node) => node.x)),
      Math.min(...nodes.map((node) => node.y)), Math.max(...nodes.map((node) => node.y)),
      Math.min(...nodes.map((node) => node.z)), Math.max(...nodes.map((node) => node.z))];
    const faceId = (Object.keys(faces) as FaceId[]).find((id) => {
      const face = faces[id];
      return panel.type === face.type && bounds.every((value, index) => close(value, face.bounds[index], scale));
    });
    if (!faceId || matched.has(faceId)) {
      throw new Error(`Schilpaneel ${panel.id} dekt geen uniek volledig rechthoekig NBC-buitenvlak.`);
    }
    const geometry = openFem3DEnvelopePanelGeometry(model, panel);
    if (!close(geometry.outer.areaM2, faces[faceId].area, faces[faceId].area)
      || dot(geometry.outwardNormal, faces[faceId].normal) < 1 - EPS) {
      throw new Error(`Schilpaneel ${panel.id} heeft een onvolledig vlak of omgekeerde buitenzijde.`);
    }
    matched.set(faceId, { panel, triangles: triangulateOpenFem3DEnvelopePanel(model, panel),
      netAreaM2: geometry.netAreaM2 });
  }
  if (matched.size !== 5) throw new Error("NBC-schil mist één of meer volledige gevel- of dakvlakken.");
  const loads: Nbc2025EnvelopeWindLoad[] = [];
  for (const windCase of cases) {
    const covered = new Map<FaceId, number>();
    for (const patch of windCase.patches) {
      const faceId: FaceId = patch.surface === "roof" ? "roof" : patch.pressurePlan.surfaceId as FaceId;
      const face = matched.get(faceId)!;
      const triangles = patch.surface !== "roof" ? face.triangles
        : face.triangles.flatMap((triangle) => windCase.direction.endsWith("X")
          ? clipOpenFem3DEnvelopeTriangle(triangle, 0, x0 + patch.boundsM.x0, x0 + patch.boundsM.x1)
          : clipOpenFem3DEnvelopeTriangle(triangle, 1, y0 + patch.boundsM.y0, y0 + patch.boundsM.y1));
      covered.set(faceId, (covered.get(faceId) ?? 0) + triangles.reduce((sum, triangle) => sum + triangle.areaM2, 0));
      triangles.forEach((triangle, index) => loads.push({
        key: `${windCase.key}:panel:${face.panel.id}:zone:${patch.pressurePlan.zone}:triangle:${index}`,
        caseKey: windCase.key, panelId: face.panel.id, surfaceId: patch.pressurePlan.surfaceId,
        zone: patch.pressurePlan.zone, qOutwardKnPerM2: patch.pressurePlan.pressure.outwardKnPerM2,
        triangle, pressurePlan: patch.pressurePlan, pressureDerivation: patch.pressureDerivation,
        referenceHeights: patch.referenceHeights,
      }));
    }
    for (const [faceId, face] of matched) {
      if (!close(covered.get(faceId) ?? 0, face.netAreaM2, face.netAreaM2)) {
        throw new Error(`NBC-zoneverdeling dekt schilpaneel ${face.panel.id} niet exact.`);
      }
    }
  }
  return { windCodeId: "ca-nbc-2025", cases, loads };
}
