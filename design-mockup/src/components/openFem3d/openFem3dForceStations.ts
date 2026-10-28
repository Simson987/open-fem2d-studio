import type { ForcePoint } from "../../lib/types/steel/ForcePoint";
import type {
  OpenFem3DDiagramPoint,
  OpenFem3DDiagrams,
  OpenFem3DMemberForces,
  OpenFem3DSolveResult,
} from "./openFem3dSolver";

type DiagramKey = keyof OpenFem3DDiagrams;

const COMPONENTS: ReadonlyArray<{
  key: DiagramKey;
  start: keyof OpenFem3DMemberForces;
  end: keyof OpenFem3DMemberForces;
  target: "n_ed" | "vy_ed" | "vz_ed" | "mt_ed" | "my_ed" | "mz_ed";
}> = [
  { key: "axial", start: "nStartKn", end: "nEndKn", target: "n_ed" },
  { key: "shearY", start: "vyStartKn", end: "vyEndKn", target: "vy_ed" },
  { key: "shearZ", start: "vzStartKn", end: "vzEndKn", target: "vz_ed" },
  { key: "torsion", start: "torsionStartKnm", end: "torsionEndKnm", target: "mt_ed" },
  { key: "momentY", start: "myStartKnm", end: "myEndKnm", target: "my_ed" },
  { key: "momentZ", start: "mzStartKnm", end: "mzEndKnm", target: "mz_ed" },
];

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

function componentPoints(
  result: OpenFem3DSolveResult,
  member: OpenFem3DMemberForces,
  key: DiagramKey,
  start: keyof OpenFem3DMemberForces,
  end: keyof OpenFem3DMemberForces,
): OpenFem3DDiagramPoint[] {
  const calculated = result.diagrams?.[key].find((diagram) => diagram.memberId === member.memberId)?.points;
  if (calculated && calculated.length >= 2) return calculated;
  return [
    { t: 0, value: Number(member[start]) },
    { t: 1, value: Number(member[end]) },
  ];
}

/**
 * Zet alle door de 3D-kern berekende staafstations om naar normtoetsinvoer.
 * Hierdoor zien staal- en betontoetsen ook veldmomenten en gedeeltelijke
 * verdeelde belastingen; een maximum tussen de knopen gaat niet verloren.
 */
export function openFem3DForceStations(
  result: OpenFem3DSolveResult,
  memberId: number,
  combinationId = 1,
): ForcePoint[] {
  const member = result.memberForces.find((value) => value.memberId === memberId);
  if (!member) return [];
  const curves = new Map(COMPONENTS.map((component) => [
    component.key,
    componentPoints(result, member, component.key, component.start, component.end),
  ]));
  const positions = [...new Set(
    [...curves.values()].flatMap((points) => points.map((point) =>
      Math.round(Math.min(1, Math.max(0, point.t)) * 1e12) / 1e12)),
  )].sort((a, b) => a - b);

  return positions.map((t) => {
    const forces = { n_ed: 0, vy_ed: 0, vz_ed: 0, mt_ed: 0, my_ed: 0, mz_ed: 0 };
    for (const component of COMPONENTS) {
      forces[component.target] = interpolate(curves.get(component.key) ?? [], t);
    }
    return {
      combination_id: combinationId,
      position_mm: t * member.lengthM * 1000,
      forces,
    };
  });
}
