import { openFem3DMemberAxes, type OpenFem3DBeam, type OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DDiagramPoint, OpenFem3DDisplacement, OpenFem3DSolveResult } from "./openFem3dSolver";
import { parseRechthoek, resolveSection } from "../../lib/sectionResolver";
import { STEEL_SECTION_DIMS } from "../../lib/steelSectionDims.generated";
import { profielAliasSleutel } from "../../lib/strip";
import { openFem3DBeddingResultOf, openFem3DBeddingSettlementAt } from "./openFem3dBedding";

type Vector3 = [number, number, number];

const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Sleutel van de profieltabellen; "Ø24" wordt "RD24" en "FL 80x10" "STRIP80X10" (`lib/strip.ts`). */
function profileKey(value: string): string {
  return profielAliasSleutel(
    value.toUpperCase().split("").filter((character) => ![" ", "-", "."].includes(character)).join(""),
  );
}

function bendingStiffness(beam: OpenFem3DBeam): { eKnM2: number; iyM4: number; izM4: number } | null {
  const material = beam.material?.trim() ?? "";
  const profile = beam.profileName?.trim() ?? "";
  const resolved = resolveSection(material, profile);
  if (resolved.bron === "default") return null;
  const catalogue = STEEL_SECTION_DIMS[profileKey(profile)]?.props;
  const rectangle = parseRechthoek(profile);
  const izMm4 = catalogue?.iz ?? (rectangle ? rectangle.h * rectangle.b ** 3 / 12 : null);
  if (!(izMm4 && izMm4 > 0)) return null;
  return { eKnM2: resolved.E * 1000, iyM4: resolved.I * 1e-12, izM4: izMm4 * 1e-12 };
}

function interpolate(points: readonly OpenFem3DDiagramPoint[], t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0].value;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    if (t <= right.t) {
      const left = points[index - 1];
      const span = right.t - left.t;
      return span > 1e-12
        ? left.value + (right.value - left.value) * (t - left.t) / span
        : right.value;
    }
  }
  return points[points.length - 1].value;
}

/** Integreer kromming tweemaal en bepaal de beginhelling uit beide eindtranslaties. */
function displacementFromCurvature(
  moments: readonly OpenFem3DDiagramPoint[],
  curvatureFactor: number,
  start: number,
  end: number,
  length: number,
  intervals: number,
): number[] {
  const dx = length / intervals;
  const curvatures = Array.from({ length: intervals + 1 }, (_, index) =>
    interpolate(moments, index / intervals) * curvatureFactor);
  const slopeFromCurvature = new Array<number>(intervals + 1).fill(0);
  const displacementFromCurvature = new Array<number>(intervals + 1).fill(0);
  for (let index = 1; index <= intervals; index += 1) {
    const left = curvatures[index - 1], right = curvatures[index];
    displacementFromCurvature[index] = displacementFromCurvature[index - 1]
      + slopeFromCurvature[index - 1] * dx
      + dx ** 2 * (left / 3 + right / 6);
    slopeFromCurvature[index] = slopeFromCurvature[index - 1] + dx * (left + right) / 2;
  }
  const startSlope = (end - start - displacementFromCurvature[intervals]) / length;
  return displacementFromCurvature.map((value, index) => start + startSlope * index * dx + value);
}

export interface OpenFem3DDisplacementStation {
  t: number;
  ux: number;
  uy: number;
  uz: number;
  magnitude: number;
}

/**
 * Euler-Bernoulli-verplaatsingslijn in de lokale staafassen. Als de solver
 * momentstations levert, wordt de kromming M/EI geïntegreerd en passen beide
 * eindtranslaties exact. Daardoor blijven verdeelde lasten en scharnieren
 * zichtbaar. Oude resultaten vallen terug op kubische eindinterpolatie. Bij
 * een staaf op een verticale bedding volgt uz de zakking die de kern langs de
 * staaf gaf (lineair tussen zijn knopen).
 */
export function openFem3DMemberDisplacementStations(
  model: OpenFem3DModel,
  beam: OpenFem3DBeam,
  result: OpenFem3DSolveResult,
  intervals = 20,
): OpenFem3DDisplacementStation[] {
  const start = model.nodes.find((node) => node.id === beam.startNodeId);
  const end = model.nodes.find((node) => node.id === beam.endNodeId);
  const startResult = result.displacements.find((value) => value.nodeId === beam.startNodeId);
  const endResult = result.displacements.find((value) => value.nodeId === beam.endNodeId);
  if (!start || !end || !startResult || !endResult) return [];
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (!(length > 0)) return [];
  const { ex, ey, ez } = openFem3DMemberAxes(start, end, beam.rollAngleRad ?? 0);
  const translation = (value: OpenFem3DDisplacement): Vector3 => [value.ux, value.uy, value.uz];
  const rotation = (value: OpenFem3DDisplacement): Vector3 => [value.rx, value.ry, value.rz];
  const u1 = translation(startResult), u2 = translation(endResult);
  const r1 = rotation(startResult), r2 = rotation(endResult);
  const localU1 = dot(ex, u1), localU2 = dot(ex, u2);
  const localV1 = dot(ey, u1), localV2 = dot(ey, u2);
  const localW1 = dot(ez, u1), localW2 = dot(ez, u2);
  const localRy1 = dot(ey, r1), localRy2 = dot(ey, r2);
  const localRz1 = dot(ez, r1), localRz2 = dot(ez, r2);
  const count = Math.max(2, Math.round(intervals));
  const stiffness = bendingStiffness(beam);
  const momentY = result.diagrams?.momentY.find((diagram) => diagram.memberId === beam.id)?.points;
  const momentZ = result.diagrams?.momentZ.find((diagram) => diagram.memberId === beam.id)?.points;
  const integratedV = stiffness && momentZ && momentZ.length >= 2
    ? displacementFromCurvature(momentZ, -1 / (stiffness.eKnM2 * stiffness.izM4), localV1, localV2, length, count)
    : null;
  const integratedW = stiffness && momentY && momentY.length >= 2
    ? displacementFromCurvature(momentY, 1 / (stiffness.eKnM2 * stiffness.iyM4), localW1, localW2, length, count)
    : null;

  // Staaf op bedding (#106): de kern geeft de zakking op zijn eigen knopen
  // langs de staaf. Die verticale verplaatsing is gezaghebbend; de vorm uit de
  // kromming en de einden geldt dan alleen nog voor de andere richtingen.
  const bedding = beam.bedding?.kKnPerM3 !== undefined ? openFem3DBeddingResultOf(result, beam.id) : undefined;
  const settlement = bedding && bedding.points.length >= 2 ? bedding : undefined;

  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const h1 = 1 - 3 * t ** 2 + 2 * t ** 3;
    const h2 = length * (t - 2 * t ** 2 + t ** 3);
    const h3 = 3 * t ** 2 - 2 * t ** 3;
    const h4 = length * (-(t ** 2) + t ** 3);
    const u = (1 - t) * localU1 + t * localU2;
    const v = integratedV?.[index] ?? (h1 * localV1 + h2 * localRz1 + h3 * localV2 + h4 * localRz2);
    // De externe kern gebruikt voor het lokale w/ry-blok de tegengestelde rotatiezin.
    const w = integratedW?.[index] ?? (h1 * localW1 - h2 * localRy1 + h3 * localW2 - h4 * localRy2);
    const ux = ex[0] * u + ey[0] * v + ez[0] * w;
    const uy = ex[1] * u + ey[1] * v + ez[1] * w;
    const uz = settlement ? -openFem3DBeddingSettlementAt(settlement, t) : ex[2] * u + ey[2] * v + ez[2] * w;
    return { t, ux, uy, uz, magnitude: Math.hypot(ux, uy, uz) };
  });
}

/** Grootste transversale vervorming ten opzichte van de verplaatste eindkoorde. */
export function openFem3DMemberFieldDeflectionMm(
  model: OpenFem3DModel,
  beam: OpenFem3DBeam,
  result: OpenFem3DSolveResult,
): number {
  const stations = openFem3DMemberDisplacementStations(model, beam, result);
  if (stations.length < 2) return 0;
  const first = stations[0], last = stations[stations.length - 1];
  return stations.reduce((maximum, station) => {
    const chordUx = first.ux + station.t * (last.ux - first.ux);
    const chordUy = first.uy + station.t * (last.uy - first.uy);
    const chordUz = first.uz + station.t * (last.uz - first.uz);
    return Math.max(maximum, Math.hypot(
      station.ux - chordUx,
      station.uy - chordUy,
      station.uz - chordUz,
    ) * 1000);
  }, 0);
}

/** Grootste werkelijke translatie in knopen of in het veld van een staaf. */
export function openFem3DMaximumDisplacementM(model: OpenFem3DModel, result: OpenFem3DSolveResult): number {
  return openFem3DMaximumDisplacement(model, result)?.valueM ?? 0;
}

/**
 * De grootste werkelijke translatie met haar plaats (onvervormd, m) en
 * verplaatsing (m): in een knoop of in het veld van een staaf. Dezelfde maat
 * als `openFem3DMaximumDisplacementM`, voor het label "u max" in het venster.
 */
export function openFem3DMaximumDisplacement(model: OpenFem3DModel, result: OpenFem3DSolveResult): {
  valueM: number;
  point: [number, number, number];
  displacement: [number, number, number];
} | null {
  const knoop = new Map(model.nodes.map((node) => [node.id, node]));
  let beste: { valueM: number; point: [number, number, number]; displacement: [number, number, number] } | null = null;
  for (const d of result.displacements) {
    const node = knoop.get(d.nodeId);
    const valueM = Math.hypot(d.ux, d.uy, d.uz);
    if (node && (!beste || valueM > beste.valueM)) {
      beste = { valueM, point: [node.x, node.y, node.z], displacement: [d.ux, d.uy, d.uz] };
    }
  }
  for (const beam of model.beams) {
    const a = knoop.get(beam.startNodeId), b = knoop.get(beam.endNodeId);
    if (!a || !b) continue;
    for (const station of openFem3DMemberDisplacementStations(model, beam, result)) {
      if (beste && station.magnitude <= beste.valueM) continue;
      beste = {
        valueM: station.magnitude,
        point: [a.x + (b.x - a.x) * station.t, a.y + (b.y - a.y) * station.t, a.z + (b.z - a.z) * station.t],
        displacement: [station.ux, station.uy, station.uz],
      };
    }
  }
  return beste;
}
