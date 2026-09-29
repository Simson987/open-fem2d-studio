/**
 * Eerste 2D-wateraccumulatiekern: één vrij opgelegde dakligger met een
 * tributair dakstrookje. Waterdruk en doorbuiging worden iteratief gekoppeld.
 *
 * Achtergrond: J. Blaauwendraad, "Praktische methode om wateraccumulatie te
 * toetsen", Bouwen met Staal (2006), p. 8–17. Dit is een eigen numerieke
 * liggerberekening, niet de vereenvoudigde NPR 6703-normtoets.
 */
export interface WaterAccumulation2DInput {
  spanM: number;
  tributaryWidthM: number;
  eiKnm2: number;
  waterLevelAboveLeftM: number;
  slopePercent?: number;
  camberMm?: number;
  initialSagMm?: number;
  waterUnitWeightKnM3?: number;
  /** Exploratory stiffness reduction from the cited 2006 method; 1 means no reduction. */
  stiffnessModelFactor?: number;
  elements?: number;
}

export interface WaterAccumulation2DResult {
  status: "converged" | "unstable";
  iterations: number;
  stiffnessRatio: number;
  criticalEiKnm2: number;
  effectiveEiKnm2: number;
  maxWaterDepthM: number;
  maxDeflectionMm: number;
  maxMomentKnm: number;
  waterVolumeM3: number;
  totalWaterLoadKn: number;
  reactionsKn: [number, number];
  points: { xM: number; roofZMm: number; deflectionMm: number; waterDepthMm: number; loadKnM: number }[];
}

function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      let value = matrix[row][col];
      for (let k = 0; k < col; k += 1) value -= lower[row][k] * lower[col][k];
      if (row === col) {
        if (!(value > 0)) throw new Error("De liggerstijfheid is niet positief definiet.");
        lower[row][col] = Math.sqrt(value);
      } else lower[row][col] = value / lower[col][col];
    }
  }
  return lower;
}

function solveCholesky(lower: number[][], forces: number[]): number[] {
  const n = forces.length;
  const intermediate = new Array<number>(n).fill(0);
  const result = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let value = forces[i];
    for (let j = 0; j < i; j += 1) value -= lower[i][j] * intermediate[j];
    intermediate[i] = value / lower[i][i];
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    let value = intermediate[i];
    for (let j = i + 1; j < n; j += 1) value -= lower[j][i] * result[j];
    result[i] = value / lower[i][i];
  }
  return result;
}

/** Positieve zakkingen en waterlasten wijzen omlaag; reacties omhoog. */
export function calculateWaterAccumulation2D(input: WaterAccumulation2DInput): WaterAccumulation2DResult {
  const { spanM: span, tributaryWidthM: width, eiKnm2: ei, waterLevelAboveLeftM: level } = input;
  const gamma = input.waterUnitWeightKnM3 ?? 10;
  const modelFactor = input.stiffnessModelFactor ?? 1;
  const count = input.elements ?? 32;
  if (![span, width, ei, level, gamma, modelFactor, input.slopePercent ?? 0, input.camberMm ?? 0, input.initialSagMm ?? 0].every(Number.isFinite)
    || span <= 0 || width <= 0 || ei <= 0 || level < 0 || gamma <= 0 || modelFactor < 1
    || !Number.isInteger(count) || count < 4 || count > 96) {
    throw new Error("Vul geldige, positieve afmetingen en buigstijfheid in.");
  }
  const step = span / count;
  const effectiveEi = ei / modelFactor;
  const dofs = 2 * (count + 1);
  const stiffness = Array.from({ length: dofs }, () => new Array<number>(dofs).fill(0));
  const factor = effectiveEi / step ** 3;
  const k = [
    [12, 6 * step, -12, 6 * step],
    [6 * step, 4 * step ** 2, -6 * step, 2 * step ** 2],
    [-12, -6 * step, 12, -6 * step],
    [6 * step, 2 * step ** 2, -6 * step, 4 * step ** 2],
  ];
  for (let element = 0; element < count; element += 1) {
    const indices = [2 * element, 2 * element + 1, 2 * element + 2, 2 * element + 3];
    for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) {
      stiffness[indices[i]][indices[j]] += factor * k[i][j];
    }
  }
  for (const fixed of [0, 2 * count]) {
    for (let i = 0; i < dofs; i += 1) stiffness[fixed][i] = stiffness[i][fixed] = 0;
    stiffness[fixed][fixed] = 1;
  }
  const lower = cholesky(stiffness);
  const roofZ = Array.from({ length: count + 1 }, (_, i) => {
    const ratio = i / count;
    const parabolic = 4 * ratio * (1 - ratio);
    return (input.slopePercent ?? 0) / 100 * span * ratio
      + ((input.camberMm ?? 0) - (input.initialSagMm ?? 0)) / 1000 * parabolic;
  });
  const loadsFor = (deflections: number[]) => roofZ.map((z, i) =>
    gamma * width * Math.max(0, level - z + deflections[i]));
  const beamSolve = (loads: number[]) => {
    const forces = new Array<number>(dofs).fill(0);
    for (let e = 0; e < count; e += 1) {
      const q0 = loads[e], q1 = loads[e + 1];
      forces[2 * e] += step * (7 * q0 + 3 * q1) / 20;
      forces[2 * e + 1] += step ** 2 * (3 * q0 + 2 * q1) / 60;
      forces[2 * e + 2] += step * (3 * q0 + 7 * q1) / 20;
      forces[2 * e + 3] -= step ** 2 * (2 * q0 + 3 * q1) / 60;
    }
    forces[0] = forces[2 * count] = 0;
    const solution = solveCholesky(lower, forces);
    return Array.from({ length: count + 1 }, (_, i) => solution[2 * i]);
  };

  let deflection = new Array<number>(count + 1).fill(0);
  let status: WaterAccumulation2DResult["status"] = "unstable";
  let iterations = 0;
  for (let iteration = 1; iteration <= 300; iteration += 1) {
    const next = beamSolve(loadsFor(deflection));
    const difference = Math.max(...next.map((value, i) => Math.abs(value - deflection[i])));
    deflection = deflection.map((value, i) => 0.5 * (value + next[i]));
    iterations = iteration;
    if (difference < 1e-8) { deflection = next; status = "converged"; break; }
    if (deflection.some((value) => !Number.isFinite(value) || Math.abs(value) > Math.max(2, span))) break;
  }
  const loads = loadsFor(deflection);
  const depths = loads.map((q) => q / (gamma * width));
  const totalLoad = loads.slice(0, -1).reduce((sum, q, i) => sum + (q + loads[i + 1]) * step / 2, 0);
  const loadMomentLeft = loads.slice(0, -1).reduce((sum, q, i) =>
    sum + i * step * (q + loads[i + 1]) * step / 2
      + step ** 2 * (q + 2 * loads[i + 1]) / 6, 0);
  const rightReaction = loadMomentLeft / span;
  const leftReaction = totalLoad - rightReaction;
  let maxMoment = 0;
  for (let i = 0; i <= count; i += 1) {
    const x = i * step;
    let moment = leftReaction * x;
    for (let e = 0; e < i; e += 1) {
      const q0 = loads[e], q1 = loads[e + 1];
      moment -= (x - e * step) * (q0 + q1) * step / 2
        - step ** 2 * (q0 + 2 * q1) / 6;
    }
    maxMoment = Math.max(maxMoment, Math.abs(moment));
  }
  const criticalEi = gamma * width * span ** 4 / Math.PI ** 4;
  return {
    status, iterations, stiffnessRatio: effectiveEi / criticalEi, criticalEiKnm2: criticalEi,
    effectiveEiKnm2: effectiveEi,
    maxWaterDepthM: Math.max(...depths),
    maxDeflectionMm: Math.max(...deflection.map(Math.abs)) * 1000,
    maxMomentKnm: maxMoment,
    waterVolumeM3: totalLoad / gamma,
    totalWaterLoadKn: totalLoad,
    reactionsKn: [leftReaction, rightReaction],
    points: roofZ.map((z, i) => ({
      xM: i * step, roofZMm: z * 1000, deflectionMm: deflection[i] * 1000,
      waterDepthMm: depths[i] * 1000, loadKnM: loads[i],
    })),
  };
}
