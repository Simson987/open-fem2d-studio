/** A circular edge passes through all three picked points, including the middle point. */
export interface ArcPoint2D { x: number; y: number }
export interface ArcPoint3D { x: number; y: number; z: number }

export interface CircularArc2D {
  center: ArcPoint2D;
  radius: number;
  startAngle: number;
  endAngle: number;
  clockwise: boolean;
  sweep: number;
}

const TAU = 2 * Math.PI;
const positiveAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;

/** Return null for three coincident or collinear points: no unique circle exists. */
export function circularArcThroughPoints2D(
  start: ArcPoint2D, through: ArcPoint2D, end: ArcPoint2D,
): CircularArc2D | null {
  const ux = through.x - start.x, uy = through.y - start.y;
  const vx = end.x - start.x, vy = end.y - start.y;
  const determinant = 2 * (ux * vy - uy * vx);
  const scaleSquared = Math.max(ux * ux + uy * uy, vx * vx + vy * vy);
  if (!(scaleSquared > 0) || Math.abs(determinant) <= 1e-12 * scaleSquared) return null;
  const uSquared = ux * ux + uy * uy, vSquared = vx * vx + vy * vy;
  const center = {
    x: start.x + (uSquared * vy - vSquared * uy) / determinant,
    y: start.y + (vSquared * ux - uSquared * vx) / determinant,
  };
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const middleAngle = Math.atan2(through.y - center.y, through.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const ccwToMiddle = positiveAngle(middleAngle - startAngle);
  const ccwToEnd = positiveAngle(endAngle - startAngle);
  const clockwise = ccwToMiddle > ccwToEnd;
  return {
    center, radius, startAngle, endAngle, clockwise,
    sweep: clockwise ? ccwToEnd - TAU : ccwToEnd,
  };
}

/** Sample the same circle in the plane of any three 3D points for canvas previews. */
export function sampleCircularArc3D(
  start: ArcPoint3D, through: ArcPoint3D, end: ArcPoint3D, steps = 24,
): ArcPoint3D[] | null {
  const chord = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const length = Math.hypot(chord.x, chord.y, chord.z);
  if (!(length > 0)) return null;
  const u = { x: chord.x / length, y: chord.y / length, z: chord.z / length };
  const middle = { x: through.x - start.x, y: through.y - start.y, z: through.z - start.z };
  const along = middle.x * u.x + middle.y * u.y + middle.z * u.z;
  const perpendicular = {
    x: middle.x - along * u.x,
    y: middle.y - along * u.y,
    z: middle.z - along * u.z,
  };
  const height = Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z);
  if (height <= 1e-12 * Math.max(length, Math.hypot(middle.x, middle.y, middle.z))) return null;
  const v = { x: perpendicular.x / height, y: perpendicular.y / height, z: perpendicular.z / height };
  const arc = circularArcThroughPoints2D({ x: 0, y: 0 }, { x: along, y: height }, { x: length, y: 0 });
  if (!arc) return null;
  return Array.from({ length: Math.max(2, steps) + 1 }, (_, index) => {
    const angle = arc.startAngle + arc.sweep * index / Math.max(2, steps);
    const x = arc.center.x + arc.radius * Math.cos(angle);
    const y = arc.center.y + arc.radius * Math.sin(angle);
    return { x: start.x + x * u.x + y * v.x, y: start.y + x * u.y + y * v.y,
      z: start.z + x * u.z + y * v.z };
  });
}
