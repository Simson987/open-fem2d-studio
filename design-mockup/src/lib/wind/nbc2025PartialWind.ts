import type { NbcLimitState } from "./nbc2025StaticWind";
import type { NbcRectangularWindCase, NbcWindDirection } from "./nbc2025RectangularWindPlan";

export const NBC_2025_PARTIAL_WIND_SOURCE =
  "NBC 2025 Vol. 1, Division B, 4.1.7.9(1) and Figure A-4.1.7.9.(1), https://doi.org/10.4224/26fz-gg26";

/** Resultant of the actual loaded facade area, about the building base. */
export interface Nbc2025HorizontalCaseResultant {
  fxKn: number;
  fyKn: number;
  baseMxKnM: number;
  baseMyKnM: number;
  /** Torsion of the projected pressure about the geometric plan centre. */
  centerMzKnM: number;
}

export interface Nbc2025HorizontalWindAction {
  /** Figure A-4.1.7.9.(1): full, eccentric, diagonal, eccentric diagonal. */
  pattern: "a" | "b" | "c" | "d";
  limitState: NbcLimitState;
  internalPressureCoefficient: number;
  pressureCaseKeys: readonly string[];
  /** Horizontal action at the geometric centre. Vertical roof action is excluded. */
  fxKn: number;
  fyKn: number;
  /** Overturning about the base; openings can move the force centre vertically. */
  baseMxKnM: number;
  baseMyKnM: number;
  /** Torsion from net pressure and the specified horizontal offsets. */
  mzKnM: number;
  offsetXM: number;
  offsetYM: number;
  source: typeof NBC_2025_PARTIAL_WIND_SOURCE;
}

/**
 * Convert the rectangular pressure plan into the horizontal force patterns of
 * NBC 2025 4.1.7.9(1). These are actions for a later structural distribution
 * step, not extra pressure panels or complete 3D load cases. In particular,
 * superposing two full pressure cases would count roof pressure twice.
 */
export function nbc2025HorizontalWindActions(
  cases: readonly NbcRectangularWindCase[], widthXM: number, widthYM: number,
  projectedResultants?: ReadonlyMap<string, Nbc2025HorizontalCaseResultant>,
): Nbc2025HorizontalWindAction[] {
  if (!Number.isFinite(widthXM) || widthXM <= 0 || !Number.isFinite(widthYM) || widthYM <= 0) {
    throw new Error("NBC 2025-deellast vraagt positieve, eindige plattegrondmaten.");
  }
  if (!cases.length) throw new Error("NBC 2025-deellast vraagt vier windrichtingen per binnendrukgeval.");
  const states = new Set(cases.map((item) => item.limitState));
  if (states.size !== 1) throw new Error("Meng geen UGT- en BGT-winddruk in een deellastpatroon.");
  const limitState = cases[0].limitState;
  const coefficients = new Set(cases.map((item) => item.internalPressureCoefficient));
  const directions: readonly NbcWindDirection[] = ["+X", "-X", "+Y", "-Y"];
  if (cases.length !== coefficients.size * directions.length
    || cases.some((item) => !Number.isFinite(item.internalPressureCoefficient)
      || !directions.includes(item.direction) || !item.patches.length
      || item.patches.some((patch) => patch.resultantKn.some((value) => !Number.isFinite(value))))) {
    throw new Error("NBC 2025-deellast vraagt volledige, eindige winddrukgevallen.");
  }
  const keys = new Set(cases.map((item) => item.key));
  if (keys.size !== cases.length || (projectedResultants && (projectedResultants.size !== cases.length
    || [...projectedResultants].some(([key, value]) => !keys.has(key) || !value
      || Object.values(value).some((component) => !Number.isFinite(component)))))) {
    throw new Error("NBC 2025-deellast vraagt één eindige projectieresultante per winddrukgeval.");
  }
  const resultant = (item: NbcRectangularWindCase): Nbc2025HorizontalCaseResultant => {
    const projected = projectedResultants?.get(item.key);
    if (projectedResultants) {
      if (!projected) throw new Error(`Projectieresultante ontbreekt voor ${item.key}.`);
      return projected;
    }
    return item.patches.reduce((sum, patch) => {
      const z = (patch.boundsM.z0 + patch.boundsM.z1) / 2;
      const [fx, fy] = patch.resultantKn;
      const x = (patch.boundsM.x0 + patch.boundsM.x1) / 2 - widthXM / 2;
      const y = (patch.boundsM.y0 + patch.boundsM.y1) / 2 - widthYM / 2;
      return { fxKn: sum.fxKn + fx, fyKn: sum.fyKn + fy,
        baseMxKnM: sum.baseMxKnM - z * fy, baseMyKnM: sum.baseMyKnM + z * fx,
        centerMzKnM: sum.centerMzKnM + x * fy - y * fx };
    }, { fxKn: 0, fyKn: 0, baseMxKnM: 0, baseMyKnM: 0, centerMzKnM: 0 });
  };
  const actions: Nbc2025HorizontalWindAction[] = [];
  const add = (pattern: Nbc2025HorizontalWindAction["pattern"],
    pair: readonly NbcRectangularWindCase[], scale: number, offsetX: number, offsetY: number) => {
    const total = pair.reduce((sum, item) => {
      const current = resultant(item);
      return { fxKn: sum.fxKn + current.fxKn, fyKn: sum.fyKn + current.fyKn,
        baseMxKnM: sum.baseMxKnM + current.baseMxKnM,
        baseMyKnM: sum.baseMyKnM + current.baseMyKnM,
        centerMzKnM: sum.centerMzKnM + current.centerMzKnM };
    }, { fxKn: 0, fyKn: 0, baseMxKnM: 0, baseMyKnM: 0, centerMzKnM: 0 });
    const fxKn = scale * total.fxKn;
    const fyKn = scale * total.fyKn;
    actions.push({ pattern, limitState, internalPressureCoefficient: pair[0].internalPressureCoefficient,
      pressureCaseKeys: pair.map((item) => item.key), fxKn, fyKn,
      baseMxKnM: scale * total.baseMxKnM, baseMyKnM: scale * total.baseMyKnM,
      mzKnM: scale * total.centerMzKnM + offsetX * fyKn - offsetY * fxKn,
      offsetXM: offsetX, offsetYM: offsetY, source: NBC_2025_PARTIAL_WIND_SOURCE });
  };
  for (const cpi of coefficients) {
    const byDirection = new Map(cases.filter((item) => item.internalPressureCoefficient === cpi)
      .map((item) => [item.direction, item]));
    if (byDirection.size !== 4) {
      throw new Error("Elk binnendrukgeval vraagt vier unieke hoofdwindrichtingen.");
    }
    for (const direction of directions) {
      const item = byDirection.get(direction)!;
      add("a", [item], 1, 0, 0);
      for (const side of [-1, 1]) {
        add("b", [item], 0.75,
          direction.endsWith("Y") ? side * 0.15 * widthXM : 0,
          direction.endsWith("X") ? side * 0.15 * widthYM : 0);
      }
    }
    for (const x of ["+X", "-X"] as const) for (const y of ["+Y", "-Y"] as const) {
      const pair = [byDirection.get(x)!, byDirection.get(y)!];
      add("c", pair, 0.75, 0, 0);
      for (const sideX of [-1, 1]) for (const sideY of [-1, 1]) {
        add("d", pair, 0.56, sideX * 0.15 * widthXM, sideY * 0.15 * widthYM);
      }
    }
  }
  return actions;
}
