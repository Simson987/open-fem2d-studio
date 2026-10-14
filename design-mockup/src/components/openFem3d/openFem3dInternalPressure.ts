import earcut from "earcut";
import type { AfleidingsRegel } from "../../lib/wind/windEurocode";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import { clipOpenFem3DEnvelopeTriangle, type EnvelopePoint3, type EnvelopeZoneTriangle } from "./openFem3dEnvelopeZones";
import { facadeWindBands } from "./openFem3dWindZones";
import type { HorizontalWindDirection } from "./openFem3dFacadeWindLoads";
import type { OpenFem3DEnvelopePanel, OpenFem3DModel } from "./openFem3dModel";

interface Face {
  key: string;
  areaM2: number;
  openingsM2: number;
  panels: { panel: OpenFem3DEnvelopePanel; normal: readonly [number, number, number];
    openingTriangles: EnvelopeZoneTriangle[] }[];
}
type Bounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
export interface InternalPressureResult {
  byDirection: Partial<Record<HorizontalWindDirection, readonly number[]>>;
  derivationByDirection: Partial<Record<HorizontalWindDirection, readonly AfleidingsRegel[]>>;
  warnings: string[];
}

function faceKey(normal: readonly [number, number, number]): string {
  if (Math.abs(normal[2]) < 1e-4 && Math.abs(Math.abs(normal[0]) - 1) < 1e-4) {
    return normal[0] > 0 ? "+X" : "-X";
  }
  if (Math.abs(normal[2]) < 1e-4 && Math.abs(Math.abs(normal[1]) - 1) < 1e-4) {
    return normal[1] > 0 ? "+Y" : "-Y";
  }
  return `roof:${normal.map((value) => value.toFixed(4)).join(":")}`;
}

function openingTriangles(geometry: ReturnType<typeof openFem3DEnvelopePanelGeometry>): EnvelopeZoneTriangle[] {
  const { outer } = geometry;
  const toWorld = ([u, v]: readonly [number, number]): EnvelopePoint3 => [
    outer.origin[0] + u * outer.axisU[0] + v * outer.axisV[0],
    outer.origin[1] + u * outer.axisU[1] + v * outer.axisV[1],
    outer.origin[2] + u * outer.axisU[2] + v * outer.axisV[2],
  ];
  return geometry.holes.flatMap((hole) => {
    const indices = earcut(hole.polygon.flatMap(([u, v]) => [u, v]), [], 2);
    return Array.from({ length: indices.length / 3 }, (_, index) => {
      const [a, b, c] = indices.slice(index * 3, index * 3 + 3);
      const points = [toWorld(hole.polygon[a]), toWorld(hole.polygon[b]), toWorld(hole.polygon[c])] as const;
      const areaM2 = Math.abs((hole.polygon[b][0] - hole.polygon[a][0]) * (hole.polygon[c][1] - hole.polygon[a][1])
        - (hole.polygon[b][1] - hole.polygon[a][1]) * (hole.polygon[c][0] - hole.polygon[a][0])) / 2;
      return { points, areaM2 };
    }).filter((triangle) => triangle.areaM2 > 1e-10);
  });
}

/**
 * EN 1991-1-4 §7.2.9(4)-(6): alleen een aantoonbaar dominante GEVEL krijgt
 * c_pi = (0,75…0,90)c_pe bij zijn openingen. Dakopeningen en niet-dominante
 * gevallen blijven op de beide normatieve standaardwaarden totdat hun
 * drukzones of permeabiliteit betrouwbaar kunnen worden bepaald.
 */
export function deriveOpenFem3DInternalPressure(
  model: OpenFem3DModel, bounds: Bounds, backgroundPermeabilityFraction = 0.001,
): InternalPressureResult {
  if (!Number.isFinite(backgroundPermeabilityFraction) || backgroundPermeabilityFraction < 0
    || backgroundPermeabilityFraction > 0.01) {
    throw new Error("Achtergronddoorlatendheid moet tussen 0 en 1% van het schiloppervlak liggen.");
  }
  const faces = new Map<string, Face>();
  for (const panel of model.envelopePanels ?? []) {
    const geometry = openFem3DEnvelopePanelGeometry(model, panel);
    const key = faceKey(geometry.outwardNormal);
    const face = faces.get(key) ?? { key, areaM2: 0, openingsM2: 0, panels: [] };
    face.areaM2 += geometry.outer.areaM2;
    face.openingsM2 += geometry.holes.reduce((sum, hole) => sum + hole.areaM2, 0);
    face.panels.push({ panel, normal: geometry.outwardNormal, openingTriangles: openingTriangles(geometry) });
    faces.set(key, face);
  }
  const all = [...faces.values()];
  if (!all.some((face) => face.openingsM2 > 0)) return { byDirection: {}, derivationByDirection: {}, warnings: [] };
  if (!["+X", "-X", "+Y", "-Y"].every((key) => faces.has(key))
    || !all.some((face) => face.key.startsWith("roof:"))) {
    return { byDirection: {}, derivationByDirection: {}, warnings: [
      "De gebouwschil mist een gevel- of dakzijde; c_pi blijft +0,2 en −0,3 omdat de openingsverhouding niet bepaalbaar is.",
    ] };
  }
  if (all.filter((face) => face.openingsM2 / face.areaM2 > 0.3).length >= 2) {
    throw new Error("Op minstens twee gebouwzijden is meer dan 30% open; EN 1991-1-4 §7.2.9(2) vraagt een andere windmodellering.");
  }
  const total = all.reduce((sum, face) => sum + face.openingsM2 + backgroundPermeabilityFraction * face.areaM2, 0);
  const dominant = all.filter((face) => face.openingsM2 > 0)
    .map((face) => ({ face, ratio: (face.openingsM2 + backgroundPermeabilityFraction * face.areaM2)
      / (total - face.openingsM2 - backgroundPermeabilityFraction * face.areaM2) }))
    .filter(({ ratio }) => ratio >= 2 - 1e-9)
    .sort((a, b) => b.ratio - a.ratio)[0];
  if (!dominant || dominant.face.key.startsWith("roof:")) {
    return { byDirection: {}, derivationByDirection: {}, warnings: [dominant
      ? "Dakopeningen domineren: c_pi blijft ±0,2/−0,3 totdat de drukzones van de openingen zijn bepaald."
      : "Geen dominante zijde uit de opgegeven openingen: c_pi blijft +0,2 en −0,3 (§7.2.9(6))."] };
  }
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const fullHeight = Math.max(bounds.maxZ, ...(model.envelopePanels ?? [])
    .filter((panel) => panel.type === "roof")
    .flatMap((panel) => panel.nodeIds.map((id) => nodeById.get(id)!.z))) - bounds.minZ;
  const byDirection: InternalPressureResult["byDirection"] = {};
  const derivationByDirection: InternalPressureResult["derivationByDirection"] = {};
  for (const direction of ["+X", "-X", "+Y", "-Y"] as const) {
    const axis: 0 | 1 = direction.endsWith("X") ? 0 : 1;
    const positive = direction.startsWith("+");
    const along = axis === 0 ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY;
    const across = axis === 0 ? bounds.maxY - bounds.minY : bounds.maxX - bounds.minX;
    const bands = facadeWindBands(across, along, fullHeight);
    let weighted = 0;
    let area = 0;
    for (const entry of dominant.face.panels) {
      const facing = entry.normal[axis] * (positive ? 1 : -1);
      const cpeBands = facing < -0.5 ? [bands.windward] : facing > 0.5 ? [bands.leeward] : bands.sides;
      for (const band of cpeBands) for (const triangle of entry.openingTriangles) {
        const parts = Math.abs(facing) < 0.5 ? clipOpenFem3DEnvelopeTriangle(triangle, axis,
          positive ? (axis === 0 ? bounds.minX : bounds.minY) + band.fromM
            : (axis === 0 ? bounds.maxX : bounds.maxY) - band.toM,
          positive ? (axis === 0 ? bounds.minX : bounds.minY) + band.toM
            : (axis === 0 ? bounds.maxX : bounds.maxY) - band.fromM) : [triangle];
        for (const part of parts) { weighted += band.cpe10 * part.areaM2; area += part.areaM2; }
      }
    }
    if (Math.abs(area - dominant.face.openingsM2) > 1e-7 * Math.max(1, area)) {
      throw new Error("Windzones op de dominante openingen sluiten niet op hun oppervlak.");
    }
    const ratio = dominant.ratio;
    const factor = ratio >= 3 ? 0.9 : 0.75 + 0.15 * (ratio - 2);
    const openingCpe = weighted / area;
    const cpi = factor * openingCpe;
    const dominantEffectiveArea = dominant.face.openingsM2
      + backgroundPermeabilityFraction * dominant.face.areaM2;
    const otherEffectiveArea = total - dominantEffectiveArea;
    byDirection[direction] = [cpi];
    derivationByDirection[direction] = [
      { symbool: "gevel", waarde: dominant.face.key, bron: "modelopeningen" },
      { symbool: "r", waarde: `${dominantEffectiveArea.toFixed(6)} / ${otherEffectiveArea.toFixed(6)} = ${ratio.toFixed(6)} `
          + `(inclusief ${(100 * backgroundPermeabilityFraction).toFixed(2)}% achtergrondlekkage)`,
        bron: "NEN-EN 1991-1-4 §7.2.9(4)-(5)" },
      { symbool: "c_pe,open", waarde: `${weighted.toFixed(6)} / ${area.toFixed(6)} = ${openingCpe.toFixed(6)}`,
        bron: "NEN-EN 1991-1-4 tabel 7.1; opening per windzone" },
      { symbool: "c_pi", waarde: `${factor.toFixed(6)} · ${openingCpe.toFixed(6)} = ${cpi.toFixed(6)}`,
        bron: "NEN-EN 1991-1-4 §7.2.9(4)-(5)" },
    ];
  }
  return { byDirection, derivationByDirection, warnings: [
    `Dominante gevel ${dominant.face.key}: c_pi = ${(dominant.ratio >= 3 ? 0.9 : 0.75 + 0.15 * (dominant.ratio - 2)).toFixed(3)} · c_pe `
      + `op de openingen (§7.2.9(4)-(5)); achtergronddoorlatendheid ${(100 * backgroundPermeabilityFraction).toFixed(2)}%.`,
  ] };
}
