import { balanceWindPressures } from "./windPressureBalance";

/** NBC 2025, Division B, 4.1.7.3: static pressure kernel (not a selectable route). */
export const NBC_2025_WIND_SOURCE =
  "NBC 2025 Vol. 1, Division B 4.1.7.3, https://doi.org/10.4224/26fz-gg26";

export type NbcImportanceCategory = "low" | "normal" | "high" | "post-disaster";
export type NbcLimitState = "uls" | "sls";
export type NbcTerrain = "open" | "rough";
export type NbcComponent = "main" | "secondary";
export type NbcMainSurface = "windward" | "leeward" | "parallelWall" | "roof";
export type NbcTopographicShape = "twoDimensionalHill" | "twoDimensionalEscarpment" | "axisymmetricHill";

export const NBC_2025_MAIN_CP_SOURCE =
  "NBC 2025 Vol. 1, Division B 4.1.7.5.(2)-(3), https://doi.org/10.4224/26fz-gg26";
export const NBC_2025_TOPOGRAPHY_SOURCE =
  "NBC 2025 Vol. 1, Division B 4.1.7.4, https://doi.org/10.4224/26fz-gg26";
export const NBC_2025_INTERNAL_GUST_SOURCE =
  "NBC 2025 Vol. 1, Division B 4.1.7.3.(10), https://doi.org/10.4224/26fz-gg26";

/** The reduced Cgi is permitted only for the building described in 4.1.7.3.(10). */
export interface Nbc2025ReducedInternalGustInput {
  internalVolumeM3: number;
  exteriorOpeningAreaM2: number;
  singleLargeUnpartitionedVolume: true;
  noNumerousOverheadDoorsOrOpenings: true;
}

export interface Nbc2025TopographyInput {
  shape: NbcTopographicShape;
  hillHeightM: number;
  /** Measured upwind distance from crest to the half-height contour. */
  upwindHalfHeightDistanceM: number;
  /** Nonnegative horizontal distance from crest; side selects the table's x sign. */
  distanceFromCrestM: number;
  side: "upwind" | "downwind";
  heightAboveGroundM: number;
  component: NbcComponent;
}

export interface Nbc2025TopographyResult {
  source: typeof NBC_2025_TOPOGRAPHY_SOURCE;
  effectiveLengthM: number;
  slope: number;
  speedUp: number;
  factor: number;
}

/** 4.1.7.4: speed-up for the three tabulated idealized hill shapes. */
export function nbc2025TopographicFactor(input: Nbc2025TopographyInput): Nbc2025TopographyResult {
  const hillHeight = positive(input.hillHeightM, "Heuvelhoogte Hh");
  const halfHeightDistance = positive(input.upwindHalfHeightDistanceM, "Afstand tot halve hoogte");
  const distance = finite(input.distanceFromCrestM, "Afstand vanaf de top");
  const height = finite(input.heightAboveGroundM, "Hoogte boven maaiveld");
  if (distance < 0 || height < 0) throw new Error("Afstand en hoogte moeten niet-negatief zijn.");
  if (input.side !== "upwind" && input.side !== "downwind") throw new Error("Zijde van de top is onbekend.");
  const parameters: Record<NbcTopographicShape, { multiplier: number; alpha: number; upwindK: number; downwindK: number }> = {
    twoDimensionalHill: { multiplier: 2.2, alpha: 3, upwindK: 1.5, downwindK: 1.5 },
    twoDimensionalEscarpment: { multiplier: 1.3, alpha: 2.5, upwindK: 1.5, downwindK: 4 },
    axisymmetricHill: { multiplier: 1.6, alpha: 4, upwindK: 1.5, downwindK: 1.5 },
  };
  const parameter = parameters[input.shape];
  if (!parameter) throw new Error("NBC 2025-heuvelvorm is onbekend.");
  const gustFactor = input.component === "main" ? 2 : input.component === "secondary" ? 2.5 : NaN;
  if (!Number.isFinite(gustFactor)) throw new Error("NBC 2025-onderdeeltype is onbekend.");
  // Lh is at least 2Hh. This also applies the table's Hh/Lh <= 0.5 cap.
  const effectiveLengthM = Math.max(halfHeightDistance, 2 * hillHeight);
  const slope = hillHeight / (2 * effectiveLengthM);
  const k = input.side === "upwind" ? parameter.upwindK : parameter.downwindK;
  const speedUp = slope > 0.1
    ? parameter.multiplier * hillHeight / effectiveLengthM
      * Math.max(0, 1 - distance / (k * effectiveLengthM))
      * Math.exp(-parameter.alpha * height / effectiveLengthM)
    : 0;
  return { source: NBC_2025_TOPOGRAPHY_SOURCE, effectiveLengthM, slope, speedUp,
    factor: (1 + speedUp / gustFactor) * (1 + speedUp) };
}

/**
 * Main structural system Cp from 4.1.7.5.(2)-(3). H and D are building height
 * and plan width parallel to wind; roof x is measured from the upwind edge.
 * The optional low-building CgCp procedure in 4.1.7.6 is a different route.
 */
export function nbc2025MainPressureCoefficient(
  surface: NbcMainSurface, buildingHeightM: number, parallelPlanWidthM: number,
  roofDistanceFromUpwindM?: number,
): number {
  const h = positive(buildingHeightM, "Gebouwhoogte H");
  const d = positive(parallelPlanWidthM, "Gebouwbreedte D in windrichting");
  const ratio = h / d;
  if (surface === "windward") return ratio < 0.25 ? 0.6 : ratio < 1 ? 0.27 * (ratio + 2) : 0.8;
  if (surface === "leeward") return ratio < 0.25 ? -0.3 : ratio < 1 ? -0.27 * (ratio + 0.88) : -0.5;
  if (surface === "parallelWall") return -0.7;
  if (surface === "roof") {
    if (roofDistanceFromUpwindM === undefined || !Number.isFinite(roofDistanceFromUpwindM)
      || roofDistanceFromUpwindM < 0 || roofDistanceFromUpwindM > d) {
      throw new Error("Dakcoëfficiënt vraagt een afstand x vanaf de loefrand binnen het dakvlak.");
    }
    return ratio >= 1 || roofDistanceFromUpwindM <= h ? -1 : -0.5;
  }
  throw new Error(`NBC 2025-vlak ${surface} is onbekend.`);
}

export interface Nbc2025StaticPressureInput {
  /** Site-specific 1-in-500 annual-exceedance reference pressure, kPa. */
  referencePressureKPa: number;
  referencePressureSource: string;
  importanceCategory: NbcImportanceCategory;
  limitState: NbcLimitState;
  terrain: NbcTerrain;
  /** Heights selected under 4.1.7.3.(6) and (7), not simply building height. */
  externalReferenceHeightM: number;
  internalReferenceHeightM: number;
  component: NbcComponent;
  /** 1.0 unless 4.1.7.4 requires a hill or escarpment calculation. */
  topographicFactor: number;
  topographicFactorSource: string;
  externalPressureCoefficient: number;
  externalCoefficientSource: string;
  internalPressureCoefficient: number;
  internalCoefficientSource: string;
  /** Omit to use the generally prescribed Cgi = 2. */
  reducedInternalGust?: Nbc2025ReducedInternalGustInput;
}

export interface Nbc2025StaticPressureResult {
  source: typeof NBC_2025_WIND_SOURCE;
  annualExceedanceProbability: number;
  referencePressureKPa: number;
  referencePressureSource: string;
  importanceCategory: NbcImportanceCategory;
  limitState: NbcLimitState;
  importanceFactor: number;
  terrain: NbcTerrain;
  externalReferenceHeightM: number;
  internalReferenceHeightM: number;
  externalExposureFactor: number;
  internalExposureFactor: number;
  topographicFactor: number;
  topographicFactorSource: string;
  component: NbcComponent;
  externalGustFactor: number;
  internalGustFactor: number;
  internalGustFactorSource: string;
  externalPressureCoefficient: number;
  externalCoefficientSource: string;
  internalPressureCoefficient: number;
  internalCoefficientSource: string;
  externalPressureKPa: number;
  internalPressureKPa: number;
  /** Positive pressure is inward; negative is outward suction. */
  netPressureKPa: number;
}

export interface Nbc2025MainSurfaceInput extends Omit<Nbc2025StaticPressureInput,
  "component" | "externalPressureCoefficient" | "externalCoefficientSource"> {
  surface: NbcMainSurface;
  buildingHeightM: number;
  parallelPlanWidthM: number;
  roofDistanceFromUpwindM?: number;
}

export interface Nbc2025MainSurfaceEnvelopeInput extends Omit<Nbc2025MainSurfaceInput,
  "internalPressureCoefficient" | "internalCoefficientSource"> {
  /** The two Cpi limits selected from a licensed or otherwise verified source. */
  internalPressureCoefficientMin: number;
  internalPressureCoefficientMax: number;
  internalCoefficientSource: string;
}

export interface Nbc2025MainSurfaceEnvelopeResult {
  /** Most outward (negative) net pressure, obtained at maximum internal pressure. */
  minimumNetPressure: Nbc2025StaticPressureResult;
  /** Most inward (positive) net pressure, obtained at minimum internal pressure. */
  maximumNetPressure: Nbc2025StaticPressureResult;
}

const IMPORTANCE: Record<NbcLimitState, Record<NbcImportanceCategory, number>> = {
  uls: { low: 0.8, normal: 1, high: 1.15, "post-disaster": 1.25 },
  sls: { low: 0.6, normal: 0.6, high: 0.6, "post-disaster": 0.6 },
};

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} moet een positief eindig getal zijn.`);
  return value;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} moet eindig zijn.`);
  return value;
}

function provenance(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} mist een bron.`);
}

/** Optional Cgi for one large unpartitioned volume without numerous large openings. */
export function nbc2025ReducedInternalGustFactor(input: Nbc2025ReducedInternalGustInput): number {
  if (input.singleLargeUnpartitionedVolume !== true
    || input.noNumerousOverheadDoorsOrOpenings !== true) {
    throw new Error("Gereduceerde Cgi vraagt bevestiging van één groot onverdeeld volume zonder talrijke openingen.");
  }
  const volume = positive(input.internalVolumeM3, "Binnenvolume V0");
  const openings = positive(input.exteriorOpeningAreaM2, "Buitenopeningen A");
  return 1 + 1 / Math.sqrt(1 + volume / (6950 * openings));
}

/** 4.1.7.3.(5): only the two prescribed terrain profiles; transitions need separate interpolation. */
export function nbc2025ExposureFactor(terrain: NbcTerrain, referenceHeightM: number): number {
  const h = positive(referenceHeightM, "Referentiehoogte");
  if (terrain === "open") return Math.max(0.9, (h / 10) ** 0.2);
  if (terrain === "rough") return Math.max(0.7, 0.7 * (h / 12) ** 0.3);
  throw new Error(`NBC 2025-terrein ${terrain} is niet beschikbaar; overgangsterrein vraagt interpolatie.`);
}

/** 4.1.7.3.(1),(3),(8),(10). Coefficients and q must come from verified NBC sources. */
export function nbc2025StaticPressure(input: Nbc2025StaticPressureInput): Nbc2025StaticPressureResult {
  const q = positive(input.referencePressureKPa, "Referentiedruk q");
  const ct = positive(input.topographicFactor, "Topografiefactor Ct");
  if (ct < 1) throw new Error("Topografiefactor Ct mag de NBC 2025-winddruk niet verlagen.");
  for (const [value, name] of [
    [input.referencePressureSource, "Referentiedruk"],
    [input.topographicFactorSource, "Topografiefactor"],
    [input.externalCoefficientSource, "Buitendrukcoëfficiënt"],
    [input.internalCoefficientSource, "Binnendrukcoëfficiënt"],
  ] as const) provenance(value, name);
  const importanceFactor = IMPORTANCE[input.limitState]?.[input.importanceCategory];
  if (importanceFactor === undefined) throw new Error("NBC 2025-gevolgklasse of grenstoestand is onbekend.");
  const externalGustFactor = input.component === "main" ? 2 : input.component === "secondary" ? 2.5 : NaN;
  if (!Number.isFinite(externalGustFactor)) throw new Error("NBC 2025-onderdeeltype is onbekend.");
  const externalExposureFactor = nbc2025ExposureFactor(input.terrain, input.externalReferenceHeightM);
  const internalExposureFactor = nbc2025ExposureFactor(input.terrain, input.internalReferenceHeightM);
  const internalGustFactor = input.reducedInternalGust
    ? nbc2025ReducedInternalGustFactor(input.reducedInternalGust) : 2;
  const externalPressureKPa = importanceFactor * q * externalExposureFactor * ct * externalGustFactor
    * finite(input.externalPressureCoefficient, "Buitendrukcoëfficiënt Cp");
  const internalPressureKPa = importanceFactor * q * internalExposureFactor * ct * internalGustFactor
    * finite(input.internalPressureCoefficient, "Binnendrukcoëfficiënt Cpi");
  const netPressureKPa = balanceWindPressures(externalPressureKPa, internalPressureKPa).inwardKnPerM2;
  return { source: NBC_2025_WIND_SOURCE, annualExceedanceProbability: 1 / 500,
    referencePressureKPa: q, referencePressureSource: input.referencePressureSource,
    importanceCategory: input.importanceCategory, limitState: input.limitState, importanceFactor,
    terrain: input.terrain, externalReferenceHeightM: input.externalReferenceHeightM,
    internalReferenceHeightM: input.internalReferenceHeightM,
    externalExposureFactor, internalExposureFactor, topographicFactor: ct,
    topographicFactorSource: input.topographicFactorSource, component: input.component,
    externalGustFactor, internalGustFactor,
    internalGustFactorSource: NBC_2025_INTERNAL_GUST_SOURCE,
    externalPressureCoefficient: input.externalPressureCoefficient,
    externalCoefficientSource: input.externalCoefficientSource,
    internalPressureCoefficient: input.internalPressureCoefficient,
    internalCoefficientSource: input.internalCoefficientSource, externalPressureKPa,
    internalPressureKPa, netPressureKPa };
}

/** Pressure on one main-system surface, retaining the exact coefficient source. */
export function nbc2025MainSurfacePressure(input: Nbc2025MainSurfaceInput): Nbc2025StaticPressureResult {
  const cp = nbc2025MainPressureCoefficient(input.surface, input.buildingHeightM,
    input.parallelPlanWidthM, input.roofDistanceFromUpwindM);
  return nbc2025StaticPressure({ ...input, component: "main", externalPressureCoefficient: cp,
    externalCoefficientSource: NBC_2025_MAIN_CP_SOURCE });
}

/** Evaluate both signed Cpi limits; a single nominal internal pressure can miss the governing load. */
export function nbc2025MainSurfacePressureEnvelope(
  input: Nbc2025MainSurfaceEnvelopeInput,
): Nbc2025MainSurfaceEnvelopeResult {
  const min = finite(input.internalPressureCoefficientMin, "Minimum binnendrukcoëfficiënt");
  const max = finite(input.internalPressureCoefficientMax, "Maximum binnendrukcoëfficiënt");
  if (min > max) throw new Error("Binnendrukcoëfficiënten staan in omgekeerde volgorde.");
  provenance(input.internalCoefficientSource, "Binnendrukcoëfficiënt");
  return {
    minimumNetPressure: nbc2025MainSurfacePressure({ ...input, internalPressureCoefficient: max }),
    maximumNetPressure: nbc2025MainSurfacePressure({ ...input, internalPressureCoefficient: min }),
  };
}
