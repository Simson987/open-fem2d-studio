import {
  berekenE, CPE_PLAT_DAK, CPE_PLAT_DAK_BRON,
  type PlatDakZone,
} from "../../lib/wind/windEurocode";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import { clipOpenFem3DEnvelopeTriangle, triangulateOpenFem3DEnvelopePanel,
  type EnvelopeZoneTriangle } from "./openFem3dEnvelopeZones";
import type { HorizontalWindDirection } from "./openFem3dFacadeWindLoads";
import type { OpenFem3DModel } from "./openFem3dModel";

export interface FlatRoofWindZone {
  direction: HorizontalWindDirection;
  variant: "I-suction" | "I-pressure";
  panelId: number;
  zone: PlatDakZone;
  cpe: number;
  triangle: EnvelopeZoneTriangle;
  sourceReference: string;
}
export interface FlatRoofWindGeneration {
  zones: FlatRoofWindZone[];
  warning: string;
}

const ZONE_I_BOTH = "Zone I van een plat dak heeft c_pe,10 = −0,2 én +0,2; beide dakvarianten krijgen een eigen windgeval.";

/** Vlak dak: F aan de hoeken, G langs de windrand, H en I verderop. */
export function generateFlatRoofWindZones(model: OpenFem3DModel, heightM: number): FlatRoofWindGeneration {
  if (!Number.isFinite(heightM) || heightM <= 0) throw new Error("Gebouwhoogte voor dakwind moet positief zijn.");
  const panels = (model.envelopePanels ?? []).filter((panel) => panel.type === "roof");
  if (!panels.length) return { zones: [], warning: ZONE_I_BOTH };
  for (const panel of panels) {
    const normal = openFem3DEnvelopePanelGeometry(model, panel).outwardNormal;
    const slopeDeg = Math.atan2(Math.hypot(normal[0], normal[1]), Math.abs(normal[2])) * 180 / Math.PI;
    if (normal[2] <= 0 || slopeDeg >= 5) {
      throw new Error(`Dakpaneel ${panel.id} is niet vlak (α ${slopeDeg.toFixed(1)}°); gebruik de hellend-dakzonering.`);
    }
  }
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const roofNodes = panels.flatMap((panel) => panel.nodeIds.map((id) => nodeById.get(id)!));
  const min = [Math.min(...roofNodes.map((node) => node.x)), Math.min(...roofNodes.map((node) => node.y))];
  const max = [Math.max(...roofNodes.map((node) => node.x)), Math.max(...roofNodes.map((node) => node.y))];
  const span = [max[0] - min[0], max[1] - min[1]];
  if (!(span[0] > 0 && span[1] > 0)) throw new Error("Een plat dak moet een positieve X- en Y-afmeting hebben.");
  const zones: FlatRoofWindZone[] = [];
  for (const direction of ["+X", "-X", "+Y", "-Y"] as const) {
    const alongAxis = direction.endsWith("X") ? 0 : 1;
    const acrossAxis = alongAxis === 0 ? 1 : 0;
    const positive = direction.startsWith("+");
    const e = berekenE(span[acrossAxis], heightM);
    const front = Math.min(e / 10, span[alongAxis]);
    const middle = Math.min(e / 2, span[alongAxis]);
    const corner = e / 4;
    const band = (triangles: readonly EnvelopeZoneTriangle[], axis: 0 | 1,
      from: number, to: number, forward: boolean) => triangles.flatMap((triangle) => {
      const low = forward ? min[axis] + from : max[axis] - to;
      const high = forward ? min[axis] + to : max[axis] - from;
      return clipOpenFem3DEnvelopeTriangle(triangle, axis, low, high);
    });
    for (const panel of panels) {
      const source = triangulateOpenFem3DEnvelopePanel(model, panel);
      const first = band(source, alongAxis, 0, front, positive);
      const h = band(source, alongAxis, front, middle, positive);
      const i = band(source, alongAxis, middle, span[alongAxis], positive);
      const f = [...band(first, acrossAxis, 0, corner, true),
        ...band(first, acrossAxis, span[acrossAxis] - corner, span[acrossAxis], true)];
      const g = band(first, acrossAxis, corner, span[acrossAxis] - corner, true);
      const byZone: readonly [PlatDakZone, EnvelopeZoneTriangle[]][] = [
        ["F", f], ["G", g], ["H", h], ["I", i],
      ];
      for (const variant of ["I-suction", "I-pressure"] as const) {
        for (const [zone, triangles] of byZone) for (const triangle of triangles) zones.push({
          direction, variant, panelId: panel.id, zone,
          cpe: zone === "I" && variant === "I-pressure" ? 0.2 : CPE_PLAT_DAK[zone],
          triangle, sourceReference: CPE_PLAT_DAK_BRON,
        });
      }
    }
  }
  return { zones, warning: ZONE_I_BOTH };
}
