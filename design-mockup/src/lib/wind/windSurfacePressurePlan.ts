import {
  balanceWindCoefficients, balanceWindPressures, type WindPressureBalance,
} from "./windPressureBalance";

/** Norm pressure for one zone and load case, before projecting it onto 2D or 3D geometry. */
export type WindSurfacePressureBasis =
  | { kind: "common-reference"; referencePressureKnPerM2: number;
      externalCoefficient: number; internalCoefficient: number; factor: number }
  | { kind: "separate-pressures"; externalPressureKnPerM2: number;
      internalPressureKnPerM2: number };

export interface WindSurfacePressurePlan {
  codeId: string;
  caseKey: string;
  surfaceId: string;
  zone: string;
  /** Source of the coefficients or separately calculated pressures. */
  source: string;
  basis: WindSurfacePressureBasis;
  /** Positive inward and positive outward are opposite signed quantities. */
  pressure: WindPressureBalance;
}

export function createWindSurfacePressurePlan(input: Omit<WindSurfacePressurePlan, "pressure">): WindSurfacePressurePlan {
  for (const key of ["codeId", "caseKey", "surfaceId", "zone", "source"] as const) {
    if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`Winddrukplan mist ${key}.`);
  }
  let pressure: WindPressureBalance;
  if (input.basis.kind === "common-reference") {
    pressure = balanceWindCoefficients(
      input.basis.referencePressureKnPerM2, input.basis.externalCoefficient,
      input.basis.internalCoefficient, input.basis.factor,
    );
  } else if (input.basis.kind === "separate-pressures") {
    pressure = balanceWindPressures(input.basis.externalPressureKnPerM2, input.basis.internalPressureKnPerM2);
  } else {
    throw new Error("Winddrukplan heeft een onbekende drukbasis.");
  }
  return { ...input, pressure };
}

/** Recompute serialized pressure so a changed basis cannot retain an old net load. */
export function parseWindSurfacePressurePlan(value: unknown): WindSurfacePressurePlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Winddrukplan heeft een ongeldige vorm.");
  }
  const raw = value as Record<string, unknown>;
  const basis = raw.basis;
  if (!basis || typeof basis !== "object" || Array.isArray(basis)) {
    throw new Error("Winddrukplan mist een drukbasis.");
  }
  const input = {
    codeId: raw.codeId, caseKey: raw.caseKey, surfaceId: raw.surfaceId,
    zone: raw.zone, source: raw.source, basis,
  } as Omit<WindSurfacePressurePlan, "pressure">;
  const expected = createWindSurfacePressurePlan(input);
  const pressure = raw.pressure;
  if (!pressure || typeof pressure !== "object" || Array.isArray(pressure)) {
    throw new Error("Winddrukplan mist de nettodruk.");
  }
  const saved = pressure as Record<string, unknown>;
  for (const key of ["inwardKnPerM2", "outwardKnPerM2"] as const) {
    if (typeof saved[key] !== "number" || !Number.isFinite(saved[key])
      || Math.abs(saved[key] - expected.pressure[key]) > 1e-10 * Math.max(1, Math.abs(expected.pressure[key]))) {
      throw new Error("Opgeslagen nettodruk komt niet overeen met de drukbasis.");
    }
  }
  return expected;
}
