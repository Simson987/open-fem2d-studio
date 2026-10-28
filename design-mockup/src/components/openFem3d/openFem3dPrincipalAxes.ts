/**
 * Eigen doorsneden met Iyz ≠ 0: de externe 3D-kern kent alleen hoofdassen.
 * De adapter draait daarom de staafassen naar u/v; dit bestand zet lokale
 * invoer en uitkomsten terug naar de y/z-assen van de profieleditor.
 */
import { isEigenProfiel, zoekEigenDoorsnede } from "../../lib/profieleditor/eigenDoorsnedenStore";
import type { OpenFem3DMemberDiagram, OpenFem3DSolveResult } from "./openFem3dSolver";

export interface OpenFem3DPrincipalSection {
  angleRad: number;
  iuMm4: number;
  ivMm4: number;
}

export function openFem3DPrincipalSection(profile: string): OpenFem3DPrincipalSection | null {
  if (!isEigenProfiel(profile)) return null;
  const eigen = zoekEigenDoorsnede(profile);
  if (!eigen) return null;
  const p = eigen.eigenschappen;
  const values = [p.iy_mm4, p.iz_mm4, p.iyz_mm4];
  if (!values.every(Number.isFinite) || !(p.iy_mm4 > 0 && p.iz_mm4 > 0)
    || !(p.iy_mm4 * p.iz_mm4 > p.iyz_mm4 ** 2)) {
    throw new Error(`Eigen doorsnede "${eigen.naam}" heeft geen geldige traagheidsmatrix (Iy, Iz, Iyz).`);
  }
  if (Math.abs(p.iyz_mm4) <= 1e-9 * (p.iy_mm4 + p.iz_mm4)) return null;
  if (![p.iu_mm4, p.iv_mm4, p.alpha_hoofdas_rad].every(Number.isFinite)
    || !(p.iu_mm4 >= p.iv_mm4 && p.iv_mm4 > 0)) {
    throw new Error(`Eigen doorsnede "${eigen.naam}" heeft geen geldige hoofdassen (Iu, Iv, α).`);
  }
  const middle = (p.iy_mm4 + p.iz_mm4) / 2;
  const radius = Math.hypot((p.iy_mm4 - p.iz_mm4) / 2, p.iyz_mm4);
  if (Math.abs(p.iu_mm4 - (middle + radius)) > 1e-7 * (middle + radius)
    || Math.abs(p.iv_mm4 - (middle - radius)) > 1e-7 * (middle - radius)) {
    throw new Error(`Eigen doorsnede "${eigen.naam}" heeft hoofdtraagheidsmomenten die niet bij Iy, Iz en Iyz passen.`);
  }
  const expectedAngle = 0.5 * Math.atan2(-2 * p.iyz_mm4, p.iy_mm4 - p.iz_mm4);
  if (Math.abs(Math.sin(p.alpha_hoofdas_rad - expectedAngle)) > 1e-7) {
    throw new Error(`Eigen doorsnede "${eigen.naam}" heeft een hoofdashoek die niet bij Iy, Iz en Iyz past.`);
  }
  return { angleRad: p.alpha_hoofdas_rad, iuMm4: p.iu_mm4, ivMm4: p.iv_mm4 };
}

/** Componenten op de gedraaide hoofdassen u/v. */
export function toOpenFem3DPrincipal(y: number, z: number, angleRad: number): [number, number] {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [c * y + s * z, -s * y + c * z];
}

/** Componenten terug op de oorspronkelijke y/z-assen. */
export function fromOpenFem3DPrincipal(u: number, v: number, angleRad: number): [number, number] {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [c * u - s * v, s * u + c * v];
}

function rotateDiagrams(
  one: OpenFem3DMemberDiagram[], two: OpenFem3DMemberDiagram[], angles: ReadonlyMap<number, number>,
): [OpenFem3DMemberDiagram[], OpenFem3DMemberDiagram[]] {
  const second = new Map(two.map((d) => [d.memberId, d]));
  const firstOut: OpenFem3DMemberDiagram[] = [];
  const secondOut = new Map<number, OpenFem3DMemberDiagram>();
  for (const first of one) {
    const angle = angles.get(first.memberId);
    const partner = second.get(first.memberId);
    if (angle === undefined) {
      firstOut.push(first);
      continue;
    }
    if (!partner) throw new Error(`Staaf ${first.memberId}: een u/v-snedekrachtlijn ontbreekt.`);
    if (first.points.length !== partner.points.length
      || first.points.some((point, i) => Math.abs(point.t - partner.points[i].t) > 1e-9)) {
      throw new Error(`Staaf ${first.memberId}: de u/v-snedekrachtlijnen hebben verschillende stations.`);
    }
    const pair = first.points.map((point, i) => fromOpenFem3DPrincipal(point.value, partner.points[i].value, angle));
    const converted = (values: number[]): OpenFem3DMemberDiagram => ({
      memberId: first.memberId,
      points: first.points.map((point, i) => ({ t: point.t, value: values[i] })),
      minValue: values.reduce((min, value) => Math.min(min, value), Infinity),
      maxValue: values.reduce((max, value) => Math.max(max, value), -Infinity),
      maxAbsValue: values.reduce((max, value) => Math.max(max, Math.abs(value)), 0),
    });
    firstOut.push(converted(pair.map((values) => values[0])));
    secondOut.set(first.memberId, converted(pair.map((values) => values[1])));
  }
  return [firstOut, two.map((diagram) => {
    if (angles.has(diagram.memberId) && !secondOut.has(diagram.memberId)) {
      throw new Error(`Staaf ${diagram.memberId}: een u/v-snedekrachtlijn ontbreekt.`);
    }
    return secondOut.get(diagram.memberId) ?? diagram;
  })];
}

/** Alleen lokale staafcomponenten veranderen; globale reacties/verplaatsingen blijven intact. */
export function fromOpenFem3DPrincipalResult(
  result: OpenFem3DSolveResult, angles: ReadonlyMap<number, number>,
): OpenFem3DSolveResult {
  if (angles.size === 0) return result;
  const memberForces = result.memberForces.map((force) => {
    const angle = angles.get(force.memberId);
    if (angle === undefined) return force;
    const [vyStartKn, vzStartKn] = fromOpenFem3DPrincipal(force.vyStartKn, force.vzStartKn, angle);
    const [vyEndKn, vzEndKn] = fromOpenFem3DPrincipal(force.vyEndKn, force.vzEndKn, angle);
    const [myStartKnm, mzStartKnm] = fromOpenFem3DPrincipal(force.myStartKnm, force.mzStartKnm, angle);
    const [myEndKnm, mzEndKnm] = fromOpenFem3DPrincipal(force.myEndKnm, force.mzEndKnm, angle);
    return { ...force, vyStartKn, vzStartKn, vyEndKn, vzEndKn, myStartKnm, mzStartKnm, myEndKnm, mzEndKnm };
  });
  let diagrams = result.diagrams;
  if (diagrams) {
    const [momentY, momentZ] = rotateDiagrams(diagrams.momentY, diagrams.momentZ, angles);
    const [shearY, shearZ] = rotateDiagrams(diagrams.shearY, diagrams.shearZ, angles);
    diagrams = { ...diagrams, momentY, momentZ, shearY, shearZ };
  }
  const ids = [...angles.keys()].sort((a, b) => a - b).join(", ");
  return {
    ...result, memberForces, diagrams,
    principalAxesMemberIds: [...angles.keys()].sort((a, b) => a - b),
    diagnostics: [...result.diagnostics,
      `Eigen doorsnede op staaf ${ids}: de 3D-kern rekent om de hoofdassen u/v; lokale V en M zijn in dit resultaat teruggerekend naar y/z. Knikslankheden y/z uit de kern gelden voor u/v.`],
  };
}
