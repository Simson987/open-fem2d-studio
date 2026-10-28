import { openFem3DMemberAxes, type OpenFem3DBeam, type OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DDiagramPoint, OpenFem3DDisplacement, OpenFem3DSolveResult } from "./openFem3dSolver";
import { CONCRETE_E_CM, NU_BETON, NU_STAAL, parseRechthoek, resolveSection } from "../../lib/sectionResolver";
import { STEEL_SECTION_DIMS } from "../../lib/steelSectionDims.generated";
import { isEigenProfiel, zoekEigenDoorsnede } from "../../lib/profieleditor/eigenDoorsnedenStore";
import { profielSleutel } from "../../lib/strip";
import { openFem3DBeddingResultOf, openFem3DBeddingSettlementAt } from "./openFem3dBedding";
import { openFem3DVerloopDelen } from "./openFem3dVerloop";
import { resolveOpenFem3DAnalysisMaterial } from "./openFem3dAnalysisMaterial";

type Vector3 = [number, number, number];

const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Sleutel van de profieltabellen; "Ø24" wordt "RD24" en "FL 80x10" "STRIP80X10" (`lib/strip.ts`). */
function profileKey(value: string): string {
  return profielSleutel(value);
}

/**
 * Buigstijfheid langs de staaf: I_y en I_z als functie van t. Prismatisch
 * constant; een verlopende staaf (#73) per gelijk deel met de doorsnede van
 * zijn midden, dezelfde delen als de kern.
 */
function bendingStiffness(
  model: OpenFem3DModel, beam: OpenFem3DBeam, lengthM: number,
): { eKnM2: number; iyM4: (t: number) => number; izM4: (t: number) => number; iyzM4?: number;
  gKnM2?: number; shearAreaYM2?: number; shearAreaZM2?: number } | null {
  const material = beam.material?.trim() ?? "";
  const profile = beam.profileName?.trim() ?? "";
  const resolved = resolveSection(material, profile);
  if (resolved.bron === "default") return null;
  const analysis = resolveOpenFem3DAnalysisMaterial(material, resolved.E,
    material in CONCRETE_E_CM ? NU_BETON : NU_STAAL, model);
  let indeling: ReturnType<typeof openFem3DVerloopDelen> = null;
  try { indeling = openFem3DVerloopDelen(beam, lengthM); } catch { return null; }
  if (indeling) {
    const delen = indeling.delen;
    const deel = (t: number) => delen[Math.min(delen.length - 1, Math.max(0, Math.floor(t * delen.length)))].doorsnede;
    return {
      eKnM2: analysis.eMpa * 1000,
      iyM4: (t) => deel(t).iyMm4 * 1e-12,
      izM4: (t) => deel(t).izMm4 * 1e-12,
    };
  }
  const catalogue = STEEL_SECTION_DIMS[profileKey(profile)]?.props;
  const rectangle = parseRechthoek(profile);
  const eigen = isEigenProfiel(profile) ? zoekEigenDoorsnede(profile) : undefined;
  const izMm4 = eigen?.eigenschappen.iz_mm4 ?? catalogue?.iz
    ?? (rectangle ? rectangle.h * rectangle.b ** 3 / 12 : null);
  if (!(izMm4 && izMm4 > 0)) return null;
  const iyM4 = resolved.I * 1e-12, izM4 = izMm4 * 1e-12;
  const areaMm2 = eigen?.eigenschappen.area_mm2 ?? (rectangle ? rectangle.b * rectangle.h : null);
  const shearAreaYMm2 = eigen?.eigenschappen.av_y_mm2 ?? catalogue?.avY
    ?? (areaMm2 ? 5 / 6 * areaMm2 : null);
  const shearAreaZMm2 = eigen?.eigenschappen.av_z_mm2 ?? catalogue?.avZ
    ?? (areaMm2 ? 5 / 6 * areaMm2 : null);
  const shear = beam.shearDeformation && shearAreaYMm2 && shearAreaYMm2 > 0
    && shearAreaZMm2 && shearAreaZMm2 > 0
    ? { gKnM2: analysis.eMpa * 1000 / (2 * (1 + analysis.nu)),
      shearAreaYM2: shearAreaYMm2 * 1e-6, shearAreaZM2: shearAreaZMm2 * 1e-6 }
    : {};
  return { eKnM2: analysis.eMpa * 1000, iyM4: () => iyM4, izM4: () => izM4,
    ...(eigen ? { iyzM4: eigen.eigenschappen.iyz_mm4 * 1e-12 } : {}), ...shear };
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

/** Twee lijnpunten binnen deze afstand (in t) vallen samen. */
const ZELFDE_T = 1e-12;

/** Eén stuk van de momentenlijn tussen twee opeenvolgende lijnpunten. */
interface MomentSegment {
  t0: number;
  t1: number;
  m0: number;
  m1: number;
  /** dM/dx aan het begin en het eind van het stuk (kNm per m). */
  d0: number;
  d1: number;
}

/** Lineaire combinatie van twee momentlijnen op hetzelfde solverrooster. */
function mixMomentSegments(
  first: readonly MomentSegment[], second: readonly MomentSegment[], a: number, b: number,
): MomentSegment[] | null {
  if (first.length !== second.length || first.some((part, i) =>
    Math.abs(part.t0 - second[i].t0) > ZELFDE_T || Math.abs(part.t1 - second[i].t1) > ZELFDE_T)) return null;
  return first.map((part, i) => ({
    t0: part.t0, t1: part.t1,
    m0: a * part.m0 + b * second[i].m0,
    m1: a * part.m1 + b * second[i].m1,
    d0: a * part.d0 + b * second[i].d0,
    d1: a * part.d1 + b * second[i].d1,
  }));
}

/** Waarde van een lijn op t, bij een sprong de waarde links of rechts ervan. */
function valueAt(points: readonly OpenFem3DDiagramPoint[], t: number, side: "left" | "right"): number {
  const same = points.filter((point) => Math.abs(point.t - t) <= ZELFDE_T);
  if (same.length > 0) return (side === "left" ? same[0] : same[same.length - 1]).value;
  return interpolate(points, t);
}

/**
 * De momentenlijn als stukken met M en dM/dx aan beide einden. De helling komt
 * uit de dwarskrachtlijn van de kern (dM_y/dx = V_z, dM_z/dx = −V_y, de
 * conventie van de kern): zo is M per stuk een kubische Hermite-veelterm, exact
 * bij een gelijkmatige en een lineair verlopende last. Zonder dwarskrachtlijn
 * (oude resultaten) is de helling die van de koorde en is M lineair per stuk.
 */
function momentSegments(
  moments: readonly OpenFem3DDiagramPoint[],
  shear: readonly OpenFem3DDiagramPoint[] | undefined,
  shearSign: 1 | -1,
  length: number,
): MomentSegment[] {
  const segments: MomentSegment[] = [];
  const aligned = shear !== undefined && shear.length === moments.length
    && shear.every((point, index) => Math.abs(point.t - moments[index].t) <= ZELFDE_T);
  for (let index = 1; index < moments.length; index += 1) {
    const a = moments[index - 1], b = moments[index];
    if (!(b.t - a.t > ZELFDE_T)) continue;
    const chord = (b.value - a.value) / ((b.t - a.t) * length);
    const d0 = !shear ? chord : shearSign * (aligned ? shear[index - 1].value : valueAt(shear, a.t, "right"));
    const d1 = !shear ? chord : shearSign * (aligned ? shear[index].value : valueAt(shear, b.t, "left"));
    segments.push({ t0: a.t, t1: b.t, m0: a.value, m1: b.value, d0, d1 });
  }
  return segments;
}

/** M en dM/dx op t binnen een stuk (kubische Hermite-veelterm). */
function momentInSegment(segment: MomentSegment, t: number, length: number): { m: number; d: number } {
  const h = (segment.t1 - segment.t0) * length;
  const u = (t - segment.t0) / (segment.t1 - segment.t0);
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  const g00 = 6 * u ** 2 - 6 * u, g10 = 3 * u ** 2 - 4 * u + 1;
  const g01 = -6 * u ** 2 + 6 * u, g11 = 3 * u ** 2 - 2 * u;
  return {
    m: h00 * segment.m0 + h10 * h * segment.d0 + h01 * segment.m1 + h11 * h * segment.d1,
    d: (g00 * segment.m0 + g10 * h * segment.d0 + g01 * segment.m1 + g11 * h * segment.d1) / h,
  };
}

/**
 * Integreer de kromming M/EI tweemaal en bepaal de beginhelling uit beide
 * eindtranslaties; geeft de verplaatsing op `stations` (t van 0 tot en met 1).
 * `curvatureFactor(t)` is 1/EI met teken; binnen een interval geldt de factor
 * van zijn midden. De intervallen lopen tussen alle lijnpunten van de kern en
 * de gevraagde stations, dus een sprong in EI (de delen van een verlopende
 * staaf, waar de kern een lijnpunt heeft) ligt op een intervalgrens.
 *
 * Per interval is de kromming κ een kubische veelterm (M per stuk Hermite, EI
 * constant); de dubbele integraal is daarmee exact (#113):
 *   Δθ = h·(κ₀/2 + h·κ₀'/12 + κ₁/2 − h·κ₁'/12),
 *   Δw = θ₀·h + h²·(7κ₀/20 + h·κ₀'/20 + 3κ₁/20 − h·κ₁'/30).
 * Tot oktober 2026 was M lineair tussen de lijnpunten; bij een verdeelde last
 * (M parabolisch) kwam de zakking dan tot 0,7 % te laag uit.
 */
function displacementFromCurvature(
  segments: readonly MomentSegment[],
  curvatureFactor: (t: number) => number,
  start: number,
  end: number,
  length: number,
  stations: readonly number[],
): number[] {
  const grid = [...new Set([0, 1, ...stations, ...segments.flatMap((segment) => [segment.t0, segment.t1])]
    .map((t) => Math.min(1, Math.max(0, t))))]
    .sort((a, b) => a - b)
    .filter((t, index, all) => index === 0 || t - all[index - 1] > ZELFDE_T);
  const segmentAt = (t: number) =>
    segments.find((segment) => t >= segment.t0 - ZELFDE_T && t <= segment.t1 + ZELFDE_T) ?? segments[segments.length - 1];
  const relative: number[] = [0];
  let w = 0, theta = 0;
  for (let index = 1; index < grid.length; index += 1) {
    const ta = grid[index - 1], tb = grid[index];
    const h = (tb - ta) * length;
    const segment = segmentAt((ta + tb) / 2);
    const factor = curvatureFactor((ta + tb) / 2);
    const a = momentInSegment(segment, ta, length), b = momentInSegment(segment, tb, length);
    const k0 = a.m * factor, k0d = a.d * factor, k1 = b.m * factor, k1d = b.d * factor;
    w += theta * h + h ** 2 * (7 * k0 / 20 + h * k0d / 20 + 3 * k1 / 20 - h * k1d / 30);
    theta += h * (k0 / 2 + h * k0d / 12 + k1 / 2 - h * k1d / 12);
    relative.push(w);
  }
  const startSlope = (end - start - w) / length;
  // Elk station ligt op het rooster (eventueel binnen ZELFDE_T van een lijnpunt).
  const nearest = (t: number) => grid.reduce((best, value, index) =>
    Math.abs(value - t) < Math.abs(grid[best] - t) ? index : best, 0);
  return stations.map((t) => start + startSlope * t * length + relative[nearest(t)]);
}

/** Extra Timoshenko-verplaatsing ∫−V/(G·Av) dx, inclusief sprongen bij puntlasten. */
function displacementFromShear(
  shear: readonly OpenFem3DDiagramPoint[], gKnM2: number, areaM2: number,
  length: number, stations: readonly number[],
): number[] {
  const grid = [...new Set([0, 1, ...stations, ...shear.map((point) => point.t)])]
    .sort((a, b) => a - b)
    .filter((t, index, all) => index === 0 || t - all[index - 1] > ZELFDE_T);
  const values = [0];
  for (let index = 1; index < grid.length; index += 1) {
    const a = grid[index - 1], b = grid[index];
    const va = valueAt(shear, a, "right"), vb = valueAt(shear, b, "left");
    values.push(values[index - 1] - (va + vb) / 2 * (b - a) * length / (gKnM2 * areaM2));
  }
  return stations.map((t) => values[grid.findIndex((value) => Math.abs(value - t) <= ZELFDE_T)]);
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
  const stiffness = bendingStiffness(model, beam, length);
  const lijn = (key: "momentY" | "momentZ" | "shearY" | "shearZ") =>
    result.diagrams?.[key]?.find((diagram) => diagram.memberId === beam.id)?.points;
  const momentY = lijn("momentY");
  const momentZ = lijn("momentZ");
  const stations = Array.from({ length: count + 1 }, (_, index) => index / count);
  const shearV = stiffness?.gKnM2 && stiffness.shearAreaYM2 && lijn("shearY")
    ? displacementFromShear(lijn("shearY")!, stiffness.gKnM2, stiffness.shearAreaYM2, length, stations)
    : null;
  const shearW = stiffness?.gKnM2 && stiffness.shearAreaZM2 && lijn("shearZ")
    ? displacementFromShear(lijn("shearZ")!, stiffness.gKnM2, stiffness.shearAreaZM2, length, stations)
    : null;
  const integrate = (
    segments: readonly MomentSegment[], factor: (t: number) => number,
    startValue: number, endValue: number, shear: number[] | null,
  ) => {
    const bending = displacementFromCurvature(segments, factor, startValue,
      endValue - (shear?.[shear.length - 1] ?? 0), length, stations);
    return shear ? bending.map((value, index) => value + shear[index]) : bending;
  };
  let integratedV: number[] | null = null;
  let integratedW: number[] | null = null;
  if (stiffness && momentY && momentY.length >= 2 && momentZ && momentZ.length >= 2
    && stiffness.iyzM4 && Math.abs(stiffness.iyzM4) > 0) {
    const iy = stiffness.iyM4(0.5), iz = stiffness.izM4(0.5), iyz = stiffness.iyzM4;
    const determinant = iy * iz - iyz ** 2;
    if (determinant > 0) {
      const my = momentSegments(momentY, lijn("shearZ"), 1, length);
      const mz = momentSegments(momentZ, lijn("shearY"), -1, length);
      // v'' = -(Iyz·My + Iy·Mz)/(E·det I),
      // w'' =  (Iz·My + Iyz·Mz)/(E·det I).
      const v = mixMomentSegments(my, mz, -iyz / determinant, -iy / determinant);
      const w = mixMomentSegments(my, mz, iz / determinant, iyz / determinant);
      if (v && w) {
        integratedV = integrate(v, () => 1 / stiffness.eKnM2, localV1, localV2, shearV);
        integratedW = integrate(w, () => 1 / stiffness.eKnM2, localW1, localW2, shearW);
      }
    }
  }
  if (!integratedV && stiffness && momentZ && momentZ.length >= 2) {
    integratedV = integrate(momentSegments(momentZ, lijn("shearY"), -1, length),
      (t) => -1 / (stiffness.eKnM2 * stiffness.izM4(t)), localV1, localV2, shearV);
  }
  if (!integratedW && stiffness && momentY && momentY.length >= 2) {
    integratedW = integrate(momentSegments(momentY, lijn("shearZ"), 1, length),
      (t) => 1 / (stiffness.eKnM2 * stiffness.iyM4(t)), localW1, localW2, shearW);
  }

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

/**
 * Stations voor de grootste veldzakking. De lijn is op elk station exact
 * (#113), maar het maximum ligt zelden op een station: met 200 intervallen
 * ligt het hoogste station tot ~4e-5 relatief onder het maximum (bij een
 * ingeklemd-opgelegde ligger). Een parabool door het hoogste station en zijn
 * buren brengt dat terug tot afrondingsniveau.
 */
const VELDZAKKING_INTERVALLEN = 200;

/**
 * De inklemming bij de meting van een uitkraging: het begin of het eind van de
 * staaf, of het eind met de kleinste verplaatsing ("kleinste"). Zie
 * `openFem3dUitkraging.ts`.
 */
export type OpenFem3DMeetInklemming = "begin" | "eind" | "kleinste";

/**
 * De transversale vervorming per station (m, als vector in globale assen):
 * zonder `inklemming` ten opzichte van de verplaatste eindkoorde, bij een
 * UITKRAGING ten opzichte van het ingeklemde eind, loodrecht op de staafas —
 * de verplaatsing van dat eind afgetrokken, zijn rotatie niet. "kleinste" kiest
 * het eind met de kleinste translatie in DEZE uitkomst.
 */
export function openFem3DMemberFieldVectorsM(
  model: OpenFem3DModel,
  beam: OpenFem3DBeam,
  result: OpenFem3DSolveResult,
  inklemming: OpenFem3DMeetInklemming | null = null,
): { t: number; v: [number, number, number] }[] {
  const stations = openFem3DMemberDisplacementStations(model, beam, result, VELDZAKKING_INTERVALLEN);
  if (stations.length < 2) return [];
  const first = stations[0], last = stations[stations.length - 1];
  if (inklemming) {
    const start = model.nodes.find((node) => node.id === beam.startNodeId);
    const end = model.nodes.find((node) => node.id === beam.endNodeId);
    if (!start || !end) return [];
    const lengte = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    if (!(lengte > 0)) return [];
    const ex = [(end.x - start.x) / lengte, (end.y - start.y) / lengte, (end.z - start.z) / lengte];
    const ref = inklemming === "begin"
      ? first
      : inklemming === "eind"
        ? last
        : first.magnitude <= last.magnitude ? first : last;
    return stations.map((station) => {
      const d = [station.ux - ref.ux, station.uy - ref.uy, station.uz - ref.uz];
      const axiaal = d[0] * ex[0] + d[1] * ex[1] + d[2] * ex[2];
      return {
        t: station.t,
        v: [d[0] - axiaal * ex[0], d[1] - axiaal * ex[1], d[2] - axiaal * ex[2]] as [number, number, number],
      };
    });
  }
  return stations.map((station) => ({
    t: station.t,
    v: [
      station.ux - (first.ux + station.t * (last.ux - first.ux)),
      station.uy - (first.uy + station.t * (last.uy - first.uy)),
      station.uz - (first.uz + station.t * (last.uz - first.uz)),
    ] as [number, number, number],
  }));
}

/**
 * Grootste transversale vervorming ten opzichte van de verplaatste eindkoorde.
 *
 * Bij een UITKRAGING (`inklemming` = het ingeklemde eind, of "kleinste") niet
 * vanaf de koorde maar vanaf het ingeklemde eind: |u(x) − u(inklemming)|
 * loodrecht op de staafas. De verplaatsing van dat eind is afgetrokken, zijn
 * rotatie niet; de koorde zou de zakking van het vrije eind grotendeels
 * wegtrekken (controle 2026-10, punt K5; zie `lib/uitkraging.ts` voor 2D).
 */
export function openFem3DMemberFieldDeflectionMm(
  model: OpenFem3DModel,
  beam: OpenFem3DBeam,
  result: OpenFem3DSolveResult,
  inklemming: OpenFem3DMeetInklemming | null = null,
): number {
  const veld = openFem3DMemberFieldVectorsM(model, beam, result, inklemming);
  if (veld.length < 2) return 0;
  const values = veld.map(({ v }) => Math.hypot(v[0], v[1], v[2]) * 1000);
  if (inklemming) return values.reduce((max, value) => Math.max(max, value), 0);
  const index = values.reduce((best, value, i) => value > values[best] ? i : best, 0);
  if (index === 0 || index === values.length - 1) return values[index];
  // Top van de parabool door drie gelijk verdeelde stations.
  const [a, b, c] = [values[index - 1], values[index], values[index + 1]];
  const curvature = a - 2 * b + c;
  return curvature < 0 ? Math.max(b, b - (a - c) ** 2 / (8 * curvature)) : b;
}

/**
 * De grootste VERANDERING van de transversale vervorming tussen twee
 * uitkomsten (mm): max over de stations van |v_a(x) − v_b(x)|, met dezelfde
 * meetlijn (koorde of inklemming) in beide. Bij "kleinste" geldt de inklemming
 * die uitkomst `a` kiest, voor beide.
 *
 * WAARVOOR. w_add = w2 + w3 is de zakking bovenop die onder de blijvende
 * belasting (NEN-EN 1990:2002/NB:2019 A1.4.3(2), figuur NB.1). Het verschil van
 * twee GROOTTES, |w| − |w₁|, is dat niet: gaat een overstek onder de blijvende
 * last omhoog en onder de veranderlijke omlaag, dan valt de verandering daarin
 * weg (controle 2026-10, punt K5). Het verschil van de vervormingsvelden houdt
 * de richting vast.
 */
export function openFem3DMemberFieldChangeMm(
  model: OpenFem3DModel,
  beam: OpenFem3DBeam,
  a: OpenFem3DSolveResult,
  b: OpenFem3DSolveResult,
  inklemming: OpenFem3DMeetInklemming | null = null,
): number {
  let vast: OpenFem3DMeetInklemming | null = inklemming;
  if (inklemming === "kleinste") {
    const stations = openFem3DMemberDisplacementStations(model, beam, a, VELDZAKKING_INTERVALLEN);
    if (stations.length >= 2) {
      vast = stations[0].magnitude <= stations[stations.length - 1].magnitude ? "begin" : "eind";
    }
  }
  const va = openFem3DMemberFieldVectorsM(model, beam, a, vast);
  const vb = openFem3DMemberFieldVectorsM(model, beam, b, vast);
  const n = Math.min(va.length, vb.length);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const d = [va[i].v[0] - vb[i].v[0], va[i].v[1] - vb[i].v[1], va[i].v[2] - vb[i].v[2]];
    max = Math.max(max, Math.hypot(d[0], d[1], d[2]) * 1000);
  }
  return max;
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
  // Ook de netknopen van platen en schijven (#228): die staan alleen in het
  // rekennet van het resultaat, niet in het model. Zonder hen gaf een plaat
  // op hoekopleggingen 0 mm.
  const knoop = new Map<number, { x: number; y: number; z: number }>(model.nodes.map((node) => [node.id, node]));
  for (const node of result.plateMesh?.nodes ?? []) if (!knoop.has(node.id)) knoop.set(node.id, node);
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
