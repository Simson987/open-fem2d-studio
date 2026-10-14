/** Code-neutral signed pressure on an envelope surface, in kN/m². */
export interface WindPressureBalance {
  /** Positive acts into the surface. */
  inwardKnPerM2: number;
  /** Positive acts away from the surface. */
  outwardKnPerM2: number;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} moet een eindig getal zijn.`);
  return value;
}

/** For routes whose external and internal pressures are calculated separately. */
export function balanceWindPressures(
  externalPressureKnPerM2: number, internalPressureKnPerM2: number,
): WindPressureBalance {
  const external = finite(externalPressureKnPerM2, "Buitendruk");
  const internal = finite(internalPressureKnPerM2, "Binnendruk");
  return { inwardKnPerM2: external - internal, outwardKnPerM2: internal - external };
}

/** For routes that apply one reference pressure and factor to both coefficients. */
export function balanceWindCoefficients(
  referencePressureKnPerM2: number, externalCoefficient: number,
  internalCoefficient: number, factor = 1,
): WindPressureBalance {
  const q = finite(referencePressureKnPerM2, "Referentiedruk");
  const cpe = finite(externalCoefficient, "Buitendrukcoëfficiënt");
  const cpi = finite(internalCoefficient, "Binnendrukcoëfficiënt");
  const multiplier = finite(factor, "Windfactor");
  if (q < 0) throw new Error("Referentiedruk mag niet negatief zijn.");
  return {
    inwardKnPerM2: q * (cpe - cpi) * multiplier,
    outwardKnPerM2: (cpi - cpe) * q * multiplier,
  };
}
