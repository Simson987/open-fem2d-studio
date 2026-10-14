/**
 * Verdeel een schilpaneel in vlakke driehoeken en knip die op globale
 * zonegrenzen. Dezelfde verdeling dient straks voor wind- en sneeuwzones:
 * een opening neemt werkelijk oppervlak weg en een grens snijdt een lastvlak
 * exact in plaats van één coëfficiënt voor het hele paneel te middelen.
 */
import earcut from "earcut";
import { openFem3DEnvelopePanelGeometry } from "./openFem3dEnvelopePanels";
import type { OpenFem3DEnvelopePanel, OpenFem3DModel } from "./openFem3dModel";

export type EnvelopePoint3 = readonly [number, number, number];
export interface EnvelopeZoneTriangle {
  /** Hoeken in meters, in het globale X/Y/Z-stelsel. */
  points: readonly [EnvelopePoint3, EnvelopePoint3, EnvelopePoint3];
  areaM2: number;
}

const EPS = 1e-9;
const triangleArea = (points: readonly EnvelopePoint3[]) => {
  const a = points[0], b = points[1], c = points[2];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
};

function triangulate(points: readonly EnvelopePoint3[]): EnvelopeZoneTriangle[] {
  if (points.length < 3) return [];
  const result: EnvelopeZoneTriangle[] = [];
  for (let index = 1; index + 1 < points.length; index += 1) {
    const corners = [points[0], points[index], points[index + 1]] as const;
    const areaM2 = triangleArea(corners);
    if (areaM2 > EPS) result.push({ points: corners, areaM2 });
  }
  return result;
}

/** Driehoeken van het netto schiloppervlak, inclusief concave contouren. */
export function triangulateOpenFem3DEnvelopePanel(
  model: OpenFem3DModel, panel: OpenFem3DEnvelopePanel,
): EnvelopeZoneTriangle[] {
  const geometry = openFem3DEnvelopePanelGeometry(model, panel);
  const { outer, holes } = geometry;
  const vertices = [...outer.polygon, ...holes.flatMap((hole) => hole.polygon)];
  const holeIndices: number[] = [];
  let offset = outer.polygon.length;
  for (const hole of holes) { holeIndices.push(offset); offset += hole.polygon.length; }
  const faces = earcut(vertices.flatMap(([u, v]) => [u, v]), holeIndices, 2);
  const toWorld = ([u, v]: readonly [number, number]): EnvelopePoint3 => [
    outer.origin[0] + u * outer.axisU[0] + v * outer.axisV[0],
    outer.origin[1] + u * outer.axisU[1] + v * outer.axisV[1],
    outer.origin[2] + u * outer.axisU[2] + v * outer.axisV[2],
  ];
  const triangles = Array.from({ length: faces.length / 3 }, (_, index) => {
    const [a, b, c] = faces.slice(index * 3, index * 3 + 3);
    const points = [toWorld(vertices[a]), toWorld(vertices[b]), toWorld(vertices[c])] as const;
    return { points, areaM2: triangleArea(points) };
  }).filter((triangle) => triangle.areaM2 > EPS);
  const covered = triangles.reduce((sum, triangle) => sum + triangle.areaM2, 0);
  if (Math.abs(covered - geometry.netAreaM2) > 1e-7 * Math.max(1, geometry.netAreaM2)) {
    throw new Error(`Schilpaneel ${panel.id}: triangulatie sluit niet op het netto oppervlak.`);
  }
  return triangles;
}

function clipPolygon(
  points: readonly EnvelopePoint3[], axis: 0 | 1 | 2, limit: number, keepGreater: boolean,
): EnvelopePoint3[] {
  const inside = (point: EnvelopePoint3) => keepGreater ? point[axis] >= limit - EPS : point[axis] <= limit + EPS;
  const result: EnvelopePoint3[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index], next = points[(index + 1) % points.length];
    const currentInside = inside(current), nextInside = inside(next);
    if (currentInside) result.push(current);
    if (currentInside !== nextInside) {
      const ratio = (limit - current[axis]) / (next[axis] - current[axis]);
      result.push(current.map((coordinate, component) =>
        component === axis ? limit : coordinate + ratio * (next[component] - coordinate)) as unknown as EnvelopePoint3);
    }
  }
  return result;
}

/** Knip een driehoek op één strook in X, Y of Z; som van oppervlakken blijft exact. */
export function clipOpenFem3DEnvelopeTriangle(
  triangle: EnvelopeZoneTriangle, axis: 0 | 1 | 2, from: number, to: number,
): EnvelopeZoneTriangle[] {
  if (!(from < to)) throw new Error("Zonegrenzen moeten oplopend zijn.");
  let polygon = triangle.points as readonly EnvelopePoint3[];
  if (Number.isFinite(from)) polygon = clipPolygon(polygon, axis, from, true);
  if (polygon.length < 3) return [];
  if (Number.isFinite(to)) polygon = clipPolygon(polygon, axis, to, false);
  return triangulate(polygon);
}
