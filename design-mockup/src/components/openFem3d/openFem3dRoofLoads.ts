import { SNOW_SHAPE_SOURCE, snowRoofPressure, snowShapeCoefficients } from "../../lib/snow/snowEurocode";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import { triangulateOpenFem3DEnvelopePanel, type EnvelopeZoneTriangle } from "./openFem3dEnvelopeZones";
import type { OpenFem3DEnvelopePanel, OpenFem3DLoadPanelDirection, OpenFem3DModel } from "./openFem3dModel";

export interface RoofLoadSettings {
  groundSnowKnPerM2: number;
  snowExposure: number;
  snowThermal: number;
  /** Optionele categorie-H-last in kN/m² horizontale projectie. */
  imposedRoofKnPerM2?: number;
}
export interface RoofLoadCasePlan {
  key: string;
  name: string;
  type: "dead" | "snow" | "live";
}
export interface RoofLoadPlan {
  key: string;
  caseKey: string;
  panelId: number;
  zone: string;
  q: number;
  direction: OpenFem3DLoadPanelDirection;
  coefficient: number;
  referencePressureKnPerM2: number;
  sourceReference: string;
  triangle: EnvelopeZoneTriangle;
}
export interface RoofLoadGeneration {
  /** Set only when the roof plan belongs to a non-Dutch code route. */
  codeId?: "ca-nbc-2025";
  roofShape: "flat" | "mono" | "duo" | "none";
  cases: RoofLoadCasePlan[];
  loads: RoofLoadPlan[];
  warnings: string[];
}

interface RoofPlane {
  panel: OpenFem3DEnvelopePanel;
  slopeDeg: number;
  horizontalNormal: readonly [number, number];
  triangles: EnvelopeZoneTriangle[];
}

function roofPlanes(model: OpenFem3DModel): RoofPlane[] {
  return (model.envelopePanels ?? []).filter((panel) => panel.type === "roof").map((panel) => {
    const normal = openFem3DEnvelopePanelGeometry(model, panel).outwardNormal;
    if (normal[2] <= 1e-6) throw new Error(`Dakpaneel ${panel.id} moet zijn buitenzijde omhoog hebben.`);
    const slopeDeg = Math.atan2(Math.hypot(normal[0], normal[1]), normal[2]) * 180 / Math.PI;
    return { panel, slopeDeg, horizontalNormal: [normal[0], normal[1]],
      triangles: triangulateOpenFem3DEnvelopePanel(model, panel) };
  });
}

function roofShape(planes: readonly RoofPlane[]): { shape: RoofLoadGeneration["roofShape"]; sides: Map<number, 0 | 1> } {
  if (planes.length === 0) return { shape: "none", sides: new Map() };
  const flat = planes.every((plane) => plane.slopeDeg < 5 - 1e-6);
  if (flat) return { shape: "flat", sides: new Map(planes.map((plane) => [plane.panel.id, 0])) };
  if (planes.some((plane) => plane.slopeDeg < 5 - 1e-6)) {
    throw new Error("Een mengsel van vlakke en hellende dakvlakken vraagt een aparte sneeuwzonering.");
  }
  const first = planes[0].horizontalNormal;
  const firstLength = Math.hypot(...first);
  const axis: readonly [number, number] = [first[0] / firstLength, first[1] / firstLength];
  const sides = new Map<number, 0 | 1>();
  for (const plane of planes) {
    const n = plane.horizontalNormal;
    const length = Math.hypot(...n);
    const alignment = (n[0] * axis[0] + n[1] * axis[1]) / length;
    if (Math.abs(alignment) < 1 - 1e-4) {
      throw new Error("Dakvlakken hebben meer dan één nokrichting; splits het gebouw voor sneeuwgeneratie.");
    }
    sides.set(plane.panel.id, alignment > 0 ? 0 : 1);
  }
  return { shape: [...sides.values()].includes(1) ? "duo" : "mono", sides };
}

/** Sneeuw, eigen gewicht van bekleding en optioneel gebruiksbelasting op dak. */
export function generateRoofAndCladdingLoads(model: OpenFem3DModel, settings: RoofLoadSettings): RoofLoadGeneration {
  const { groundSnowKnPerM2, snowExposure, snowThermal, imposedRoofKnPerM2 = 0 } = settings;
  if (![groundSnowKnPerM2, snowExposure, snowThermal, imposedRoofKnPerM2].every(
    (value) => Number.isFinite(value) && value >= 0,
  ) || snowExposure === 0 || snowThermal === 0) {
    throw new Error("Sneeuw- en daklastinstellingen moeten eindige, niet-negatieve waarden hebben; C_e en C_t zijn positief.");
  }
  const planes = roofPlanes(model);
  const { shape, sides } = roofShape(planes);
  const cases: RoofLoadCasePlan[] = [];
  const loads: RoofLoadPlan[] = [];
  const warnings: string[] = [];
  const addCase = (key: string, name: string, type: RoofLoadCasePlan["type"]) => {
    cases.push({ key, name, type });
    return key;
  };
  const add = (caseKey: string, plane: RoofPlane, coefficient: number,
    referencePressureKnPerM2: number, direction: OpenFem3DLoadPanelDirection, zone: string,
    sourceReference: string) => {
    const q = coefficient * referencePressureKnPerM2;
    if (q <= 1e-12) return;
    plane.triangles.forEach((triangle, index) => loads.push({
      key: `${caseKey}:panel:${plane.panel.id}:piece:${index}`, caseKey, panelId: plane.panel.id,
      zone, q, direction, coefficient, referencePressureKnPerM2, sourceReference, triangle,
    }));
  };

  if (planes.length > 0 && groundSnowKnPerM2 > 0) {
    const pressure = snowRoofPressure(1, groundSnowKnPerM2, snowExposure, snowThermal);
    const balanced = addCase("envelope3d:snow:balanced", "Sneeuw dak gelijkmatig", "snow");
    for (const plane of planes) {
      const mu = snowShapeCoefficients(plane.slopeDeg).mu1;
      if (mu === 0) warnings.push(`Dakpaneel ${plane.panel.id}: μ₁ = 0 bij ${plane.slopeDeg.toFixed(1)}°; controleer sneeuwvang.`);
      add(balanced, plane, mu, pressure, "gravity", "μ₁", SNOW_SHAPE_SOURCE);
    }
    if (shape === "duo") for (const reducedSide of [0, 1] as const) {
      const caseKey = addCase(`envelope3d:snow:drift:${reducedSide}`,
        `Sneeuw dak ongelijkmatig ${reducedSide + 1}`, "snow");
      for (const plane of planes) {
        const mu = snowShapeCoefficients(plane.slopeDeg).mu1;
        add(caseKey, plane, sides.get(plane.panel.id) === reducedSide ? mu / 2 : mu,
          pressure, "gravity", sides.get(plane.panel.id) === reducedSide ? "½μ₁" : "μ₁", SNOW_SHAPE_SOURCE);
      }
    }
  }
  if (imposedRoofKnPerM2 > 0 && planes.length > 0) {
    const caseKey = addCase("envelope3d:roof:live:H", "Dak gebruiksbelasting H", "live");
    for (const plane of planes) add(caseKey, plane, 1, imposedRoofKnPerM2, "gravity", "H",
      "NEN-EN 1991-1-1 categorie H; intensiteit door gebruiker ingevoerd");
  }
  const cladding = (model.envelopePanels ?? []).filter((panel) => (panel.claddingWeightKnPerM2 ?? 0) > 0);
  if (cladding.length) {
    const caseKey = addCase("envelope3d:cladding:dead", "Bekleding eigen gewicht", "dead");
    for (const panel of cladding) {
      const triangles = triangulateOpenFem3DEnvelopePanel(model, panel);
      triangles.forEach((triangle, index) => loads.push({
        key: `${caseKey}:panel:${panel.id}:piece:${index}`, caseKey, panelId: panel.id,
        zone: "bekleding", q: panel.claddingWeightKnPerM2!, direction: "verticalSurface",
        coefficient: 1, referencePressureKnPerM2: panel.claddingWeightKnPerM2!,
        sourceReference: "eigen gewicht bekleding: invoer per schilpaneel", triangle,
      }));
    }
  }
  return { roofShape: shape, cases, loads, warnings };
}
