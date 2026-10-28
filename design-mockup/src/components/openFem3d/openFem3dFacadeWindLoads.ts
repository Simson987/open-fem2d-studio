import {
  CPI_BRON, CPI_ONBEKEND, TABEL_71_BRON,
  type AfleidingsRegel, type TerreinCategorie, type Windgebied,
} from "../../lib/wind/windEurocode";
import { calculateWindReferencePressure, requireWindCodeId,
  type WindCodeId, type WindPressureRequest } from "../../lib/wind/windCodeRoute";
import { createWindSurfacePressurePlan } from "../../lib/wind/windSurfacePressurePlan";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import {
  clipOpenFem3DEnvelopeTriangle, triangulateOpenFem3DEnvelopePanel,
  type EnvelopeZoneTriangle,
} from "./openFem3dEnvelopeZones";
import { facadeWindBands } from "./openFem3dWindZones";
import type { OpenFem3DEnvelopePanel, OpenFem3DModel } from "./openFem3dModel";

export type HorizontalWindDirection = "+X" | "-X" | "+Y" | "-Y";
export interface FacadeWindSettings {
  /** Ontbreekt alleen bij oudere projecten; onbekende routes worden geweigerd. */
  windCodeId?: WindCodeId;
  windgebied?: Windgebied;
  terreincategorie?: TerreinCategorie;
  /** A user supplied peak velocity pressure, constant across reference heights. */
  manualPressureKnPerM2?: number;
  manualPressureSource?: string;
  /** Constructiefactor c_s·c_d; bij ontbreken 1. */
  structuralFactor?: number;
  /** Referentiehoogte per gevelpaneel in m boven peil; standaard hoogste knoop. */
  referenceHeightByPanel?: Readonly<Record<number, number>>;
  /** Zonder openingsanalyse worden beide ongunstige waarden gegenereerd. */
  internalPressureCoefficients?: readonly number[];
  /** Per windrichting berekende c_pi uit dominante openingen. */
  internalPressureByDirection?: Partial<Record<HorizontalWindDirection, readonly number[]>>;
  internalPressureDerivationByDirection?: Partial<Record<HorizontalWindDirection, readonly AfleidingsRegel[]>>;
  /** Aangenomen achtergrondlekkage als fractie van elke gebouwzijde (standaard 0,001). */
  backgroundPermeabilityFraction?: number;
}
export interface FacadeWindLoadPlan {
  key: string;
  caseKey: string;
  panelId: number;
  zone: string;
  direction: HorizontalWindDirection;
  cpe: number;
  cpi: number;
  internalPressureDerivation: readonly AfleidingsRegel[];
  qpKnPerM2: number;
  referenceHeightM: number;
  pressureDerivation: readonly AfleidingsRegel[];
  pressureMethod: "en-terreinprofiel" | "handmatig-opgegeven";
  structuralFactor: number;
  /** Positief naar de buitenzijde; werkelijke vlakterkte in kN/m². */
  qOutwardKnPerM2: number;
  triangle: EnvelopeZoneTriangle;
  sourceReference: string;
}
export interface FacadeWindCasePlan {
  key: string;
  name: string;
  direction: HorizontalWindDirection;
  cpi: number;
  internalPressureDerivation: readonly AfleidingsRegel[];
}
export interface FacadeWindGeneration {
  windCodeId: WindCodeId;
  cases: FacadeWindCasePlan[];
  loads: FacadeWindLoadPlan[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

const directions = ["+X", "-X", "+Y", "-Y"] as const;
const sign = (value: number) => value >= 0 ? "+" : "";

export function facadeWindPressureRequest(settings: FacadeWindSettings): WindPressureRequest {
  if (settings.manualPressureKnPerM2 !== undefined) {
    if (!Number.isFinite(settings.manualPressureKnPerM2) || settings.manualPressureKnPerM2 <= 0) {
      throw new Error("Handmatige stuwdruk moet een positief eindig getal zijn.");
    }
    if (settings.windgebied !== undefined || settings.terreincategorie !== undefined) {
      throw new Error("Kies óf handmatige stuwdruk óf windgebied en terreincategorie.");
    }
    return { codeId: settings.windCodeId, source: "manual",
      pressureKnPerM2: settings.manualPressureKnPerM2,
      pressureSource: settings.manualPressureSource };
  }
  if (!settings.windgebied || !settings.terreincategorie) {
    throw new Error("Geef voor berekende winddruk zowel windgebied als terreincategorie.");
  }
  if (settings.manualPressureSource !== undefined) {
    throw new Error("Een bron voor handmatige stuwdruk vraagt ook de handmatige stuwdruk.");
  }
  return { codeId: settings.windCodeId, source: "calculated",
    windgebied: settings.windgebied, terreincategorie: settings.terreincategorie };
}

function boundsOfPanels(model: OpenFem3DModel, panels: readonly OpenFem3DEnvelopePanel[]) {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const nodes = panels.flatMap((panel) => panel.nodeIds.map((id) => byId.get(id)));
  if (nodes.some((node) => !node)) throw new Error("Een schilpaneel verwijst naar een ontbrekende knoop.");
  const points = nodes as typeof model.nodes;
  const bounds = {
    minX: Math.min(...points.map((node) => node.x)), maxX: Math.max(...points.map((node) => node.x)),
    minY: Math.min(...points.map((node) => node.y)), maxY: Math.max(...points.map((node) => node.y)),
    minZ: Math.min(...points.map((node) => node.z)), maxZ: Math.max(...points.map((node) => node.z)),
  };
  if (!(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY && bounds.maxZ > bounds.minZ)) {
    throw new Error("Windzonering vraagt gevelpanelen met een positieve gebouwbreedte, diepte en hoogte.");
  }
  return bounds;
}

/**
 * Maak de gevelwindlasten per zone als geometrische plannen. De volgende stap
 * zet elke driehoek om in een gewoon 3D-belastingvlak. Daarom kan de
 * krachtsom al vóór enig modelschrijven analytisch worden gecontroleerd.
 */
export function generateFacadeWindLoads(
  model: OpenFem3DModel, settings: FacadeWindSettings,
): FacadeWindGeneration {
  const windCodeId = requireWindCodeId(settings.windCodeId);
  const panels = (model.envelopePanels ?? []).filter((panel) => panel.type === "facade");
  if (panels.length === 0) throw new Error("Teken eerst gevelpanelen voor windgeneratie.");
  const bounds = boundsOfPanels(model, panels);
  const factor = settings.structuralFactor ?? 1;
  if (!Number.isFinite(factor) || factor <= 0) throw new Error("Constructiefactor c_s·c_d moet positief zijn.");
  const pressureRequest = facadeWindPressureRequest(settings);
  const cases: FacadeWindCasePlan[] = [];
  const loads: FacadeWindLoadPlan[] = [];
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const roofTop = Math.max(bounds.maxZ, ...(model.envelopePanels ?? [])
    .filter((panel) => panel.type === "roof")
    .flatMap((panel) => panel.nodeIds.map((id) => byId.get(id)!.z)));
  for (const direction of directions) {
    const cpis = settings.internalPressureByDirection?.[direction]
      ?? settings.internalPressureCoefficients ?? CPI_ONBEKEND;
    if (!cpis.length || cpis.some((value) => !Number.isFinite(value)) || new Set(cpis).size !== cpis.length) {
      throw new Error("Geef minstens één eindige, unieke waarde voor c_pi.");
    }
    const axis = direction.endsWith("X") ? 0 : 1;
    const positive = direction.startsWith("+");
    const along = axis === 0 ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY;
    const across = axis === 0 ? bounds.maxY - bounds.minY : bounds.maxX - bounds.minX;
    const height = roofTop - bounds.minZ;
    const zones = facadeWindBands(across, along, height);
    for (const cpi of cpis) {
      const internalPressureDerivation = settings.internalPressureDerivationByDirection?.[direction]
        ?? [{ symbool: "c_pi", waarde: `${cpi}`,
          bron: settings.internalPressureCoefficients || settings.internalPressureByDirection
            ? "door gebruiker opgegeven" : CPI_BRON }];
      const caseKey = `envelope3d:wind:${direction}:cpi:${cpi}`;
      cases.push({ key: caseKey, name: `Wind ${direction}, c_pi ${sign(cpi)}${cpi}`,
        direction, cpi, internalPressureDerivation });
      for (const panel of panels) {
        const geometry = openFem3DEnvelopePanelGeometry(model, panel);
        const normal = geometry.outwardNormal;
        if (Math.abs(normal[2]) > 1e-4
          || Math.abs(Math.abs(normal[0]) + Math.abs(normal[1]) - 1) > 1e-4
          || (Math.abs(normal[0]) > 1e-4 && Math.abs(normal[1]) > 1e-4)) {
          throw new Error(`Gevelpaneel ${panel.id} is geen verticale X- of Y-gevel voor deze windzonering.`);
        }
        const top = Math.max(...panel.nodeIds.map((id) => byId.get(id)!.z));
        const referenceHeight = settings.referenceHeightByPanel?.[panel.id] ?? top - bounds.minZ;
        if (!Number.isFinite(referenceHeight) || referenceHeight <= 0 || referenceHeight > 200) {
          throw new Error(`Gevelpaneel ${panel.id} heeft een ongeldige windreferentiehoogte.`);
        }
        const pressure = calculateWindReferencePressure(pressureRequest, referenceHeight);
        const qp = pressure.qp_kNm2;
        const facing = normal[axis] * (positive ? 1 : -1);
        const source = triangulateOpenFem3DEnvelopePanel(model, panel);
        const bands = facing < -0.5 ? [zones.windward] : facing > 0.5 ? [zones.leeward] : zones.sides;
        for (const band of bands) {
          const pieces = Math.abs(facing) < 0.5 ? source.flatMap((triangle) => {
            const start = positive ? (axis === 0 ? bounds.minX : bounds.minY) + band.fromM
              : (axis === 0 ? bounds.maxX : bounds.maxY) - band.toM;
            const end = positive ? (axis === 0 ? bounds.minX : bounds.minY) + band.toM
              : (axis === 0 ? bounds.maxX : bounds.maxY) - band.fromM;
            return clipOpenFem3DEnvelopeTriangle(triangle, axis, start, end);
          }) : source;
          const qOutwardKnPerM2 = createWindSurfacePressurePlan({
            codeId: windCodeId, caseKey, surfaceId: String(panel.id), zone: band.zone,
            source: TABEL_71_BRON,
            basis: { kind: "common-reference", referencePressureKnPerM2: qp,
              externalCoefficient: band.cpe10, internalCoefficient: cpi, factor },
          }).pressure.outwardKnPerM2;
          if (Math.abs(qOutwardKnPerM2) < 1e-12) continue;
          pieces.forEach((triangle, index) => loads.push({
            key: `${caseKey}:panel:${panel.id}:zone:${band.zone}:piece:${index}`,
            caseKey, panelId: panel.id, zone: band.zone, direction,
            cpe: band.cpe10, cpi, internalPressureDerivation,
            qpKnPerM2: qp, referenceHeightM: pressure.ze_m,
            pressureDerivation: pressure.afleiding, structuralFactor: factor,
            pressureMethod: pressure.handmatig ? "handmatig-opgegeven" : "en-terreinprofiel",
            qOutwardKnPerM2, triangle, sourceReference: TABEL_71_BRON,
          }));
        }
      }
    }
  }
  return { windCodeId, cases, loads, bounds };
}
