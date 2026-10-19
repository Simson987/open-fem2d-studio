import { frame3DMemberAxes, type Frame3DBeam, type Frame3DMemberLoad,
  type Frame3DMemberPointLoad, type Frame3DNode } from "./frame3dModel";

type Vector3 = [number, number, number];
type Local12 = [number, number, number, number, number, number,
  number, number, number, number, number, number];

function globalEquivalent(
  local: Local12, beam: Frame3DBeam, start: Frame3DNode, end: Frame3DNode,
): Array<{ forceKn: Vector3; momentKnm: Vector3 }> {
  const { ex, ey, ez } = frame3DMemberAxes(start, end, beam.rollAngleRad ?? 0);
  const globalVector = (x: number, y: number, z: number): Vector3 => [0, 1, 2].map((axis) =>
    x * ex[axis] + y * ey[axis] + z * ez[axis]) as Vector3;
  return [0, 6].map((offset) => ({
    forceKn: globalVector(local[offset], local[offset + 1], local[offset + 2]),
    momentKnm: globalVector(local[offset + 3], local[offset + 4], local[offset + 5]),
  }));
}

/**
 * Consistent Euler-Bernoulli nodal vector for a linearly varying transverse
 * load over any subspan. The three Gauss points integrate Hermite × linear
 * intensity exactly. DOFs match the Rust frame kernel's local 12-vector.
 */
export function frame3DMemberEquivalentLoad(
  beam: Frame3DBeam,
  start: Frame3DNode,
  end: Frame3DNode,
  load: Frame3DMemberLoad,
  factor = 1,
): { local: Local12; global: Array<{ forceKn: Vector3; momentKnm: Vector3 }> } {
  if (load.beamId !== beam.id) throw new Error(`Staaflast ${load.id}: staafverwijzing klopt niet.`);
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const a = load.startPositionM, submittedEnd = load.endPositionM;
  if (!(length > 0) || ![a, submittedEnd, load.qyStart, load.qyEnd, load.qzStart, load.qzEnd, factor].every(Number.isFinite)
      || a < 0 || submittedEnd <= a || submittedEnd > length + 1e-9) {
    throw new Error(`Staaflast ${load.id}: ongeldige lengte, intensiteit of combinatiefactor.`);
  }
  const b = Math.min(submittedEnd, length);
  if (b <= a) throw new Error(`Staaflast ${load.id}: ongeldige lengte, intensiteit of combinatiefactor.`);
  const local = Array(12).fill(0) as Local12;
  const abscissae = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)];
  const weights = [5 / 9, 8 / 9, 5 / 9];
  for (let point = 0; point < 3; point++) {
    const x = (a + b) / 2 + (b - a) * abscissae[point] / 2;
    const t = x / length;
    const shape = [1 - 3 * t * t + 2 * t ** 3,
      length * (t - 2 * t * t + t ** 3),
      3 * t * t - 2 * t ** 3,
      length * (-t * t + t ** 3)];
    const position = (x - a) / (b - a);
    const scale = factor * weights[point] * (b - a) / 2;
    const py = (load.qyStart * (1 - position) + load.qyEnd * position) * scale;
    const pz = (load.qzStart * (1 - position) + load.qzEnd * position) * scale;
    [1, 5, 7, 11].forEach((dof, index) => { local[dof] += py * shape[index]; });
    [2, 4, 8, 10].forEach((dof, index) => { local[dof] += pz * shape[index] * (index % 2 === 0 ? 1 : -1); });
  }
  return { local, global: globalEquivalent(local, beam, start, end) };
}

/** Consistent Hermite nodal vector for a transverse point force on a frame member. */
export function frame3DMemberPointEquivalentLoad(
  beam: Frame3DBeam,
  start: Frame3DNode,
  end: Frame3DNode,
  load: Frame3DMemberPointLoad,
  factor = 1,
): { local: Local12; global: Array<{ forceKn: Vector3; momentKnm: Vector3 }> } {
  if (load.beamId !== beam.id) throw new Error(`Staafpuntlast ${load.id}: staafverwijzing klopt niet.`);
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const x = load.positionM;
  if (!(length > 0) || ![x, load.py, load.pz, factor].every(Number.isFinite)
      || x < 0 || x > length + 1e-9) {
    throw new Error(`Staafpuntlast ${load.id}: ongeldige lengte, kracht of combinatiefactor.`);
  }
  const t = Math.min(x / length, 1);
  const shape = [1 - 3 * t * t + 2 * t ** 3,
    length * (t - 2 * t * t + t ** 3),
    3 * t * t - 2 * t ** 3,
    length * (-t * t + t ** 3)];
  const local = Array(12).fill(0) as Local12;
  [1, 5, 7, 11].forEach((dof, index) => { local[dof] += factor * load.py * shape[index]; });
  [2, 4, 8, 10].forEach((dof, index) => {
    local[dof] += factor * load.pz * shape[index] * (index % 2 === 0 ? 1 : -1);
  });
  return { local, global: globalEquivalent(local, beam, start, end) };
}
