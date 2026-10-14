import { calculateWindReferencePressure } from "../../lib/wind/windCodeRoute";
import { createWindSurfacePressurePlan } from "../../lib/wind/windSurfacePressurePlan";
import {
  facadeWindPressureRequest, generateFacadeWindLoads, type FacadeWindGeneration, type FacadeWindSettings,
  type HorizontalWindDirection,
} from "./openFem3dFacadeWindLoads";
import { generateFlatRoofWindZones } from "./openFem3dFlatRoofWind";
import { generatePitchedRoofWindZones } from "./openFem3dPitchedRoofWind";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import { deriveOpenFem3DInternalPressure } from "./openFem3dInternalPressure";
import type { OpenFem3DModel } from "./openFem3dModel";

export interface Wind3DGeneration extends FacadeWindGeneration {
  warnings: string[];
}

/**
 * Eén windgeval bevat tegelijk de gevels én het dak. Varianten van zone I
 * krijgen elk hun eigen geval; de geveldruk wordt dan in beide gevallen
 * opgenomen, zodat de combinatie nooit alleen de dakzuiging ziet.
 */
export function generateWind3DLoads(model: OpenFem3DModel, settings: FacadeWindSettings): Wind3DGeneration {
  const baseFacades = generateFacadeWindLoads(model, settings);
  const internal = settings.internalPressureCoefficients || settings.internalPressureByDirection
    ? { byDirection: {}, derivationByDirection: {}, warnings: [] }
    : deriveOpenFem3DInternalPressure(model, baseFacades.bounds, settings.backgroundPermeabilityFraction);
  const facades = Object.keys(internal.byDirection).length
    ? generateFacadeWindLoads(model, { ...settings, internalPressureByDirection: internal.byDirection,
      internalPressureDerivationByDirection: internal.derivationByDirection })
    : baseFacades;
  const roofPanels = (model.envelopePanels ?? []).filter((panel) => panel.type === "roof");
  if (roofPanels.length === 0) return { ...facades, warnings: internal.warnings };
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const roofMaxZ = Math.max(...roofPanels.flatMap((panel) => panel.nodeIds.map((id) => byId.get(id)!.z)));
  const height = Math.max(facades.bounds.maxZ, roofMaxZ) - facades.bounds.minZ;
  const normal = openFem3DEnvelopePanelGeometry(model, roofPanels[0]).outwardNormal;
  const slope = Math.atan2(Math.hypot(normal[0], normal[1]), Math.abs(normal[2])) * 180 / Math.PI;
  const flat = slope < 5 ? generateFlatRoofWindZones(model, height) : null;
  const pitched = flat ? null : generatePitchedRoofWindZones(model, height);
  const roofZones = flat?.zones ?? pitched!.zones;
  const roofVariants = pitched?.variants;
  const factor = settings.structuralFactor ?? 1;
  const roofPressure = calculateWindReferencePressure(facadeWindPressureRequest(settings), height);
  const qpRoof = roofPressure.qp_kNm2;
  const cases: FacadeWindGeneration["cases"] = [];
  const loads: FacadeWindGeneration["loads"] = [];
  const directions = ["+X", "-X", "+Y", "-Y"] as const;
  for (const direction of directions) {
    const zoneI = roofZones.some((zone) => zone.direction === direction && zone.zone === "I");
    const variants = roofVariants
      ? roofVariants.filter((item) => item.direction === direction).map((item) => item.variant)
      : zoneI ? ["I-suction", "I-pressure"] : ["I-suction"];
    const baseCases = facades.cases.filter((item) => item.direction === direction);
    for (const base of baseCases) for (const variant of variants) {
      const caseKey = `${base.key}:roof:${variant}`;
      const roofName = flat ? (variant === "I-suction" ? "I −" : "I +") : variant;
      cases.push({ ...base, key: caseKey, name: `${base.name}, dak ${roofName}` });
      for (const load of facades.loads.filter((item) => item.caseKey === base.key)) {
        loads.push({ ...load, caseKey, key: `${caseKey}:${load.key}` });
      }
      const zones = roofZones.filter((item) => item.direction === direction && item.variant === variant);
      zones.forEach((zone, index) => {
        const qOutwardKnPerM2 = createWindSurfacePressurePlan({
          codeId: facades.windCodeId, caseKey, surfaceId: String(zone.panelId), zone: zone.zone,
          source: zone.sourceReference,
          basis: { kind: "common-reference", referencePressureKnPerM2: qpRoof,
            externalCoefficient: zone.cpe, internalCoefficient: base.cpi, factor },
        }).pressure.outwardKnPerM2;
        if (Math.abs(qOutwardKnPerM2) < 1e-12) return;
        loads.push({
        key: `${caseKey}:roof:${zone.panelId}:${zone.zone}:${index}`, caseKey,
        panelId: zone.panelId, zone: zone.zone, direction: direction as HorizontalWindDirection,
        cpe: zone.cpe, cpi: base.cpi, internalPressureDerivation: base.internalPressureDerivation,
        qpKnPerM2: qpRoof,
        referenceHeightM: roofPressure.ze_m, pressureDerivation: roofPressure.afleiding,
        pressureMethod: roofPressure.handmatig ? "handmatig-opgegeven" : "en-terreinprofiel",
        structuralFactor: factor,
        qOutwardKnPerM2,
        triangle: zone.triangle, sourceReference: zone.sourceReference,
        });
      });
    }
  }
  return { windCodeId: facades.windCodeId, cases, loads, bounds: facades.bounds,
    warnings: [...internal.warnings, ...(flat && zoneIForAnyDirection(roofZones) ? [flat.warning] : [])] };
}

function zoneIForAnyDirection(zones: readonly { zone: string }[]): boolean {
  return zones.some((zone) => zone.zone === "I");
}
