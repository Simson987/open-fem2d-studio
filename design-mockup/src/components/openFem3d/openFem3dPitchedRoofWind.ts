import { berekenE, hellendDakCpe, type CpeCel, type HellendDakTheta,
  type HellendDakVorm, type HellendDakZone } from "../../lib/wind/windEurocode";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import { clipOpenFem3DEnvelopeTriangle, triangulateOpenFem3DEnvelopePanel,
  type EnvelopeZoneTriangle } from "./openFem3dEnvelopeZones";
import type { HorizontalWindDirection } from "./openFem3dFacadeWindLoads";
import type { OpenFem3DEnvelopePanel, OpenFem3DModel } from "./openFem3dModel";

export interface PitchedRoofWindZone {
  direction: HorizontalWindDirection;
  variant: string;
  panelId: number;
  zone: HellendDakZone;
  cpe: number;
  triangle: EnvelopeZoneTriangle;
  sourceReference: string;
}
export interface PitchedRoofWindGeneration {
  shape: "mono" | "duo";
  zones: PitchedRoofWindZone[];
  variants: { direction: HorizontalWindDirection; variant: string }[];
}

interface RoofPlane {
  panel: OpenFem3DEnvelopePanel;
  alpha: number;
  horizontal: readonly [number, number];
  triangles: EnvelopeZoneTriangle[];
}
interface Piece {
  direction: HorizontalWindDirection;
  panelId: number;
  zone: HellendDakZone;
  group: "dak" | "loef" | "lij";
  cell: CpeCel;
  triangle: EnvelopeZoneTriangle;
  sourceReference: string;
}

const EPS = 1e-7;

/** Lessenaars- en zadeldak: F–J volgens figuur 7.7/7.8, tabellen NB.8–NB.11. */
export function generatePitchedRoofWindZones(model: OpenFem3DModel, heightM: number): PitchedRoofWindGeneration {
  if (!Number.isFinite(heightM) || heightM <= 0) throw new Error("Gebouwhoogte voor dakwind moet positief zijn.");
  const panels = (model.envelopePanels ?? []).filter((panel) => panel.type === "roof");
  if (!panels.length) throw new Error("Teken eerst dakpanelen voor hellend-dakwind.");
  const planes: RoofPlane[] = panels.map((panel) => {
    const normal = openFem3DEnvelopePanelGeometry(model, panel).outwardNormal;
    if (normal[2] <= 0) throw new Error(`Dakpaneel ${panel.id} moet zijn buitenzijde omhoog hebben.`);
    const alpha = Math.atan2(Math.hypot(normal[0], normal[1]), normal[2]) * 180 / Math.PI;
    if (alpha < 5 - EPS || alpha > 75 + EPS) {
      throw new Error(`Dakpaneel ${panel.id}: dakhelling ${alpha.toFixed(1)}° valt buiten de tabellen voor hellende daken.`);
    }
    return { panel, alpha, horizontal: [normal[0], normal[1]],
      triangles: triangulateOpenFem3DEnvelopePanel(model, panel) };
  });
  const first = planes[0].horizontal;
  const slopeAxis: 0 | 1 = Math.abs(first[0]) >= Math.abs(first[1]) ? 0 : 1;
  const ridgeAxis: 0 | 1 = slopeAxis === 0 ? 1 : 0;
  if (planes.some((plane) => Math.abs(plane.horizontal[ridgeAxis]) > 1e-4
    || Math.abs(plane.horizontal[slopeAxis]) < 1e-4)) {
    throw new Error("Dakvlakken moeten een X- of Y-gerichte helling en één nokrichting hebben.");
  }
  const signs = new Set(planes.map((plane) => Math.sign(plane.horizontal[slopeAxis])));
  const shape = signs.size === 1 ? "mono" : "duo";
  const form: HellendDakVorm = shape === "mono" ? "lessenaar" : "zadel";
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const points = panels.flatMap((panel) => panel.nodeIds.map((id) => byId.get(id)!));
  const min = [Math.min(...points.map((node) => node.x)), Math.min(...points.map((node) => node.y))];
  const max = [Math.max(...points.map((node) => node.x)), Math.max(...points.map((node) => node.y))];
  const span = [max[0] - min[0], max[1] - min[1]];
  if (!(span[0] > 0 && span[1] > 0)) throw new Error("Het dak heeft geen positieve X- en Y-afmetingen.");
  const maxZ = Math.max(...points.map((node) => node.z));
  const ridgePositions = points.filter((node) => maxZ - node.z < 1e-5)
    .map((node) => slopeAxis === 0 ? node.x : node.y);
  const ridgeCoord = ridgePositions.reduce((sum, value) => sum + value, 0) / ridgePositions.length;
  if (shape === "duo" && (ridgeCoord <= min[slopeAxis] + 1e-5 || ridgeCoord >= max[slopeAxis] - 1e-5
    || ridgePositions.some((value) => Math.abs(value - ridgeCoord) > 1e-5))) {
    throw new Error("Een zadeldak vraagt een doorlopende nok tussen beide dakranden.");
  }
  const clipDistance = (triangles: readonly EnvelopeZoneTriangle[], axis: 0 | 1,
    positive: boolean, from: number, to: number) => to <= from + EPS ? [] : triangles.flatMap((triangle) => {
    const low = positive ? min[axis] + from : max[axis] - to;
    const high = positive ? min[axis] + to : max[axis] - from;
    return clipOpenFem3DEnvelopeTriangle(triangle, axis, low, high);
  });
  const pieces: Piece[] = [];
  for (const direction of ["+X", "-X", "+Y", "-Y"] as const) {
    const alongAxis: 0 | 1 = direction.endsWith("X") ? 0 : 1;
    const acrossAxis: 0 | 1 = alongAxis === 0 ? 1 : 0;
    const positive = direction.startsWith("+");
    const e = berekenE(span[acrossAxis], heightM);
    const front = Math.min(e / 10, span[alongAxis]);
    const middle = Math.min(e / 2, span[alongAxis]);
    const corner = e / 4;
    const theta: HellendDakTheta = alongAxis === ridgeAxis ? 90
      : shape === "duo" ? 0
        : Math.sign(first[slopeAxis]) * (positive ? 1 : -1) < 0 ? 0 : 180;
    for (const plane of planes) {
      const lookup = hellendDakCpe(form, theta, plane.alpha);
      if (!lookup.ok) throw new Error(`Dakpaneel ${plane.panel.id}: ${lookup.reden}`);
      const add = (zone: HellendDakZone, triangles: readonly EnvelopeZoneTriangle[], group: Piece["group"]) => {
        const cell = lookup.zones[zone];
        if (!cell) throw new Error(`Tabel ${lookup.tabel} mist zone ${zone} voor dakpaneel ${plane.panel.id}.`);
        triangles.forEach((triangle) => pieces.push({ direction, panelId: plane.panel.id, zone,
          group, cell, triangle, sourceReference: lookup.bron }));
      };
      if (theta === 90) {
        const firstStrip = clipDistance(plane.triangles, alongAxis, positive, 0, front);
        const near = clipDistance(firstStrip, acrossAxis, true, 0, corner);
        const far = clipDistance(firstStrip, acrossAxis, true, span[acrossAxis] - corner, span[acrossAxis]);
        if (shape === "mono") {
          const lowEdge = points.filter((node) => Math.abs((acrossAxis === 0 ? node.x : node.y) - min[acrossAxis]) < 1e-5);
          const highEdge = points.filter((node) => Math.abs((acrossAxis === 0 ? node.x : node.y) - max[acrossAxis]) < 1e-5);
          const nearHigh = Math.max(...lowEdge.map((node) => node.z)) > Math.max(...highEdge.map((node) => node.z));
          add(nearHigh ? "Fhoog" : "Flaag", near, "dak");
          add(nearHigh ? "Flaag" : "Fhoog", far, "dak");
        } else { add("F", near, "dak"); add("F", far, "dak"); }
        add("G", clipDistance(firstStrip, acrossAxis, true, corner, span[acrossAxis] - corner), "dak");
        add("H", clipDistance(plane.triangles, alongAxis, positive, front, middle), "dak");
        add("I", clipDistance(plane.triangles, alongAxis, positive, middle, span[alongAxis]), "dak");
        continue;
      }
      const windward = shape === "mono" || plane.horizontal[slopeAxis] * (positive ? 1 : -1) < 0;
      const group: Piece["group"] = shape === "duo" ? (windward ? "loef" : "lij") : "dak";
      if (windward) {
        const firstStrip = clipDistance(plane.triangles, alongAxis, positive, 0, front);
        add("F", [
          ...clipDistance(firstStrip, acrossAxis, true, 0, corner),
          ...clipDistance(firstStrip, acrossAxis, true, span[acrossAxis] - corner, span[acrossAxis]),
        ], group);
        add("G", clipDistance(firstStrip, acrossAxis, true, corner, span[acrossAxis] - corner), group);
        const end = shape === "duo" ? (positive ? ridgeCoord - min[alongAxis] : max[alongAxis] - ridgeCoord)
          : span[alongAxis];
        add("H", clipDistance(plane.triangles, alongAxis, positive, front, end), group);
      } else {
        const start = positive ? ridgeCoord - min[alongAxis] : max[alongAxis] - ridgeCoord;
        const end = Math.min(start + e / 10, span[alongAxis]);
        add("J", clipDistance(plane.triangles, alongAxis, positive, start, end), group);
        add("I", clipDistance(plane.triangles, alongAxis, positive, end, span[alongAxis]), group);
      }
    }
  }
  const zones: PitchedRoofWindZone[] = [];
  const variants: PitchedRoofWindGeneration["variants"] = [];
  for (const direction of ["+X", "-X", "+Y", "-Y"] as const) {
    const directionPieces = pieces.filter((piece) => piece.direction === direction);
    const groups = [...new Set(directionPieces.map((piece) => piece.group))].sort();
    let options: { key: string; signs: Record<string, "neg" | "pos"> }[] = [{ key: "base", signs: {} }];
    for (const group of groups) {
      if (!directionPieces.some((piece) => piece.group === group
        && piece.cell.neg !== undefined && piece.cell.pos !== undefined)) continue;
      options = options.flatMap((option) => (["neg", "pos"] as const).map((sign) => ({
        key: option.key === "base" ? `${group}:${sign}` : `${option.key}:${group}:${sign}`,
        signs: { ...option.signs, [group]: sign },
      })));
    }
    for (const option of options) {
      variants.push({ direction, variant: option.key });
      for (const piece of directionPieces) {
        const chosen = option.signs[piece.group] ?? "neg";
        const cpe = piece.cell[chosen] ?? piece.cell.neg ?? piece.cell.pos;
        if (cpe === undefined) throw new Error(`Zone ${piece.zone} heeft geen c_pe-waarde.`);
        zones.push({ direction, variant: option.key, panelId: piece.panelId,
          zone: piece.zone, cpe, triangle: piece.triangle, sourceReference: piece.sourceReference });
      }
    }
  }
  return { shape, zones, variants };
}
