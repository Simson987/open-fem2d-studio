import type { Frame3DMemberLoad, Frame3DMemberPointLoad } from "./frame3dModel";
import type { Frame3DDiagrams, Frame3DMemberForces } from "./frame3dSolver";

type Scaled<T> = { load: T; factor: number };
type GeometricState = { localDisplacements: readonly number[]; axialForceKn: number };

/** Reconstruct section forces from corrected end actions, physical loads and optional P-Δ geometry. */
export function frame3DVolumeMemberDiagrams(
  members: readonly Frame3DMemberForces[],
  lineLoads: readonly Scaled<Frame3DMemberLoad>[],
  pointLoads: readonly Scaled<Frame3DMemberPointLoad>[],
  geometricByMember: ReadonlyMap<number, GeometricState> = new Map(),
): Frame3DDiagrams {
  const diagrams: Frame3DDiagrams = {
    momentY: [], momentZ: [], shearY: [], shearZ: [], axial: [], torsion: [],
  };
  const group = <T extends { beamId: number }>(loads: readonly Scaled<T>[]) => {
    const byBeam = new Map<number, Scaled<T>[]>();
    for (const entry of loads) {
      if (entry.factor === 0) continue;
      const items = byBeam.get(entry.load.beamId) ?? [];
      items.push(entry);
      byBeam.set(entry.load.beamId, items);
    }
    return byBeam;
  };
  const linesByBeam = group(lineLoads);
  const pointsByBeam = group(pointLoads);
  for (const member of members) {
    const length = member.lengthM;
    const lines = linesByBeam.get(member.memberId) ?? [];
    const points = pointsByBeam.get(member.memberId) ?? [];
    const geometric = geometricByMember.get(member.memberId);
    if (geometric && (geometric.localDisplacements.length !== 12
        || !geometric.localDisplacements.every(Number.isFinite)
        || !Number.isFinite(geometric.axialForceKn))) {
      throw new Error(`Staaf ${member.memberId}: ongeldige tweede-orde-diagramtoestand.`);
    }
    // Unloaded and point-loaded first-order members are piecewise linear;
    // keep their result footprint small even in very large frame meshes.
    const positions = new Set<number>(lines.length || geometric
      ? Array.from({ length: 21 }, (_, i) => i / 20) : [0, 1]);
    for (const { load } of lines) {
      positions.add(load.startPositionM / length);
      positions.add(load.endPositionM / length);
    }
    for (const { load } of points) {
      const t = load.positionM / length;
      for (const shifted of [t - 1e-6, t, t + 1e-6]) {
        if (shifted >= 0 && shifted <= 1) positions.add(shifted);
      }
    }
    // Every load interval has a linear q(x), so transverse shear is quadratic
    // and bending moment is cubic (also with the Hermite P-Delta term). Add
    // their true stationary points instead of relying on the 5% display grid.
    const boundaries = [...new Set([0, length,
      ...lines.flatMap(({ load }) => [load.startPositionM, load.endPositionM]),
      ...points.map(({ load }) => load.positionM)])].sort((a, b) => a - b);
    const transverseSlope = (kind: "momentY" | "momentZ", x: number) => {
      const z = kind === "momentY", sign = z ? 1 : -1;
      let slope = z ? member.vzStartKn : -member.vyStartKn;
      for (const { load, factor } of lines) {
        const a = load.startPositionM, b = load.endPositionM;
        if (x <= a) continue;
        const s = Math.min(x, b) - a;
        const qi = z ? load.qzStart : load.qyStart;
        const dq = (z ? load.qzEnd : load.qyEnd) - qi;
        slope += sign * factor * (qi * s + dq * s * s / (2 * (b - a)));
      }
      for (const { load, factor } of points) {
        if (x > load.positionM) slope += sign * factor * (z ? load.pz : load.py);
      }
      if (geometric) {
        const q = geometric.localDisplacements, t = x / length;
        const dh = [(-6 * t + 6 * t * t) / length,
          1 - 4 * t + 3 * t * t,
          (6 * t - 6 * t * t) / length,
          -2 * t + 3 * t * t];
        const transverse = z
          ? dh[0] * q[2] - dh[1] * q[4] + dh[2] * q[8] - dh[3] * q[10]
          : dh[0] * q[1] + dh[1] * q[5] + dh[2] * q[7] + dh[3] * q[11];
        slope += sign * geometric.axialForceKn * transverse;
      }
      return slope;
    };
    for (let interval = 1; interval < boundaries.length; interval++) {
      const a = boundaries[interval - 1], b = boundaries[interval], span = b - a;
      if (span <= 1e-12) continue;
      for (const kind of ["momentY", "momentZ"] as const) {
        const y1 = transverseSlope(kind, a + span / 4);
        const y2 = transverseSlope(kind, a + span / 2);
        const y3 = transverseSlope(kind, a + 3 * span / 4);
        const quadratic = 8 * (y3 - 2 * y2 + y1);
        const linear = 4 * (y2 - y1) - 3 * quadratic / 4;
        const constant = y1 - quadratic / 16 - linear / 4;
        const roots = Math.abs(quadratic) <= 1e-12 * Math.max(1, Math.abs(linear), Math.abs(constant))
          ? Math.abs(linear) > 1e-14 ? [-constant / linear] : []
          : (() => {
            const discriminant = linear * linear - 4 * quadratic * constant;
            if (discriminant < 0) return [];
            const sqrt = Math.sqrt(discriminant);
            return [(-linear - sqrt) / (2 * quadratic), (-linear + sqrt) / (2 * quadratic)];
          })();
        for (const root of roots) {
          if (root > 0 && root < 1) positions.add((a + root * span) / length);
        }
      }
      for (const z of [false, true]) {
        const intensity = (x: number) => lines.reduce((sum, { load, factor }) => {
          if (x <= load.startPositionM || x >= load.endPositionM) return sum;
          const fraction = (x - load.startPositionM) / (load.endPositionM - load.startPositionM);
          const qi = z ? load.qzStart : load.qyStart;
          const qj = z ? load.qzEnd : load.qyEnd;
          return sum + factor * (qi + (qj - qi) * fraction);
        }, 0);
        const q1 = intensity(a + span / 4), q3 = intensity(a + 3 * span / 4);
        if (Math.abs(q3 - q1) > 1e-14) {
          const root = 0.25 - q1 * 0.5 / (q3 - q1);
          if (root > 0 && root < 1) positions.add((a + root * span) / length);
        }
      }
    }
    const stations = [...new Set([...positions].map((t) => Math.round(t * 1e12) / 1e12))]
      .filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b);
    for (const kind of Object.keys(diagrams) as Array<keyof Frame3DDiagrams>) {
      const samples = stations.map((t) => {
        const x = t * length;
        let value = kind === "axial" ? member.nStartKn + t * (member.nEndKn - member.nStartKn)
          : kind === "torsion" ? member.torsionStartKnm + t * (member.torsionEndKnm - member.torsionStartKnm)
          : kind === "shearY" ? member.vyStartKn
          : kind === "shearZ" ? member.vzStartKn
          : kind === "momentY" ? member.myStartKnm + member.vzStartKn * x
          : member.mzStartKnm - member.vyStartKn * x;
        if (geometric && (kind === "momentY" || kind === "momentZ")) {
          const q = geometric.localDisplacements;
          const h = [1 - 3 * t * t + 2 * t ** 3, length * (t - 2 * t * t + t ** 3),
            3 * t * t - 2 * t ** 3, length * (-t * t + t ** 3)];
          const transverse = kind === "momentZ"
            ? h[0] * q[1] + h[1] * q[5] + h[2] * q[7] + h[3] * q[11] - q[1]
            : h[0] * q[2] - h[1] * q[4] + h[2] * q[8] - h[3] * q[10] - q[2];
          value += (kind === "momentY" ? 1 : -1) * geometric.axialForceKn * transverse;
        }
        const transverse = kind === "momentY" || kind === "momentZ"
          || kind === "shearY" || kind === "shearZ";
        if (transverse) {
          for (const { load, factor } of lines) {
            const a = load.startPositionM, b = load.endPositionM;
            if (x <= a) continue;
            const s = Math.min(x, b) - a, span = b - a;
            const z = kind === "momentY" || kind === "shearZ";
            const qi = z ? load.qzStart : load.qyStart;
            const dq = (z ? load.qzEnd : load.qyEnd) - qi;
            const integratedForce = factor * (qi * s + dq * s * s / (2 * span));
            const integratedMoment = factor * (qi * (s * (x - a) - s * s / 2)
              + dq / span * (s * s * (x - a) / 2 - s * s * s / 3));
            value += kind === "shearY" || kind === "shearZ" ? integratedForce
              : kind === "momentY" ? integratedMoment : -integratedMoment;
          }
          for (const { load, factor } of points) {
            if (load.positionM >= x - 1e-10) continue;
            const p = (kind === "momentY" || kind === "shearZ") ? load.pz : load.py;
            value += kind === "shearY" || kind === "shearZ" ? factor * p
              : (kind === "momentY" ? 1 : -1) * factor * p * (x - load.positionM);
          }
        }
        return { t, value };
      });
      const values = samples.map(({ value }) => value);
      diagrams[kind].push({ memberId: member.memberId, points: samples,
        maxValue: Math.max(...values), minValue: Math.min(...values),
        maxAbsValue: Math.max(...values.map(Math.abs)) });
    }
  }
  return diagrams;
}
