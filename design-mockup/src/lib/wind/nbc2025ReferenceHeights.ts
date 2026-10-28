import {
  nbc2025MainSurfacePressure, nbc2025MainSurfacePressureEnvelope,
  type Nbc2025MainSurfaceEnvelopeInput, type Nbc2025MainSurfaceInput,
  type NbcMainSurface,
} from "./nbc2025StaticWind";

export const NBC_2025_REFERENCE_HEIGHT_SOURCE =
  "NBC 2025 Vol. 1, Division B 4.1.7.3.(6)-(7), https://doi.org/10.4224/26fz-gg26";

export interface Nbc2025ReferenceGeometry {
  /** Smaller plan dimension D of the building. */
  smallerPlanDimensionM: number;
  /** Mid-height of the roof above grade. */
  roofMidHeightM: number;
  /** Mid-height of the building above grade. */
  buildingMidHeightM: number;
  hasDominantOpening: boolean;
  /** Height of the point on the windward wall whose pressure is calculated. */
  windwardPointHeightM?: number;
  /** Mid-height of the dominant opening, when there is one. */
  dominantOpeningMidHeightM?: number;
}

export interface Nbc2025ReferenceHeights {
  source: typeof NBC_2025_REFERENCE_HEIGHT_SOURCE;
  lowBuildingRule: boolean;
  externalReferenceHeightM: number;
  internalReferenceHeightM: number;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} moet een positief eindig getal zijn.`);
  return value;
}

/** Choose Ce and Cei heights before evaluating NBC static main-surface pressure. */
export function nbc2025ReferenceHeights(
  surface: NbcMainSurface, buildingHeightM: number, geometry: Nbc2025ReferenceGeometry,
): Nbc2025ReferenceHeights {
  const height = positive(buildingHeightM, "Gebouwhoogte H");
  const width = positive(geometry.smallerPlanDimensionM, "Kleinste plattegrondmaat D");
  const roofMid = positive(geometry.roofMidHeightM, "Dakmiddelhoogte");
  const buildingMid = positive(geometry.buildingMidHeightM, "Gebouwmiddelhoogte");
  if (typeof geometry.hasDominantOpening !== "boolean") {
    throw new Error("Aanwezigheid van een dominante opening moet expliciet zijn.");
  }
  const openingMid = geometry.dominantOpeningMidHeightM === undefined ? undefined
    : positive(geometry.dominantOpeningMidHeightM, "Middelhoogte dominante opening");
  if (height > 20 && geometry.hasDominantOpening && openingMid === undefined) {
    throw new Error("Dominante opening vraagt een middelhoogte voor Cei.");
  }
  if (!geometry.hasDominantOpening && openingMid !== undefined) {
    throw new Error("Middelhoogte van een dominante opening is opgegeven zonder dominante opening.");
  }
  const lowBuildingRule = height <= 20 && height < width;
  let externalReferenceHeightM: number;
  if (lowBuildingRule) externalReferenceHeightM = Math.max(6, roofMid);
  else if (surface === "windward") {
    if (geometry.windwardPointHeightM === undefined) throw new Error("Hoogte loefgevelpunt ontbreekt.");
    externalReferenceHeightM = positive(geometry.windwardPointHeightM, "Hoogte loefgevelpunt");
  } else if (surface === "leeward") externalReferenceHeightM = buildingMid;
  else if (surface === "parallelWall" || surface === "roof") externalReferenceHeightM = roofMid;
  else throw new Error(`NBC 2025-vlak ${surface} is onbekend.`);
  if (lowBuildingRule && !["windward", "leeward", "parallelWall", "roof"].includes(surface)) {
    throw new Error(`NBC 2025-vlak ${surface} is onbekend.`);
  }
  const internalReferenceHeightM = height > 20 && geometry.hasDominantOpening
    && openingMid !== undefined
    ? openingMid : Math.max(6, buildingMid);
  return { source: NBC_2025_REFERENCE_HEIGHT_SOURCE, lowBuildingRule,
    externalReferenceHeightM, internalReferenceHeightM };
}

export type Nbc2025MainSurfaceGeometryInput = Omit<Nbc2025MainSurfaceInput,
  "externalReferenceHeightM" | "internalReferenceHeightM"> & {
  referenceGeometry: Nbc2025ReferenceGeometry;
};

/** Keep the selected heights and their normative source beside the pressure. */
export function nbc2025MainSurfacePressureFromGeometry(input: Nbc2025MainSurfaceGeometryInput) {
  const { referenceGeometry, ...pressureInput } = input;
  const referenceHeights = nbc2025ReferenceHeights(input.surface, input.buildingHeightM, referenceGeometry);
  return { referenceHeights, pressure: nbc2025MainSurfacePressure({ ...pressureInput,
    externalReferenceHeightM: referenceHeights.externalReferenceHeightM,
    internalReferenceHeightM: referenceHeights.internalReferenceHeightM }) };
}

export type Nbc2025MainSurfaceEnvelopeGeometryInput = Omit<Nbc2025MainSurfaceEnvelopeInput,
  "externalReferenceHeightM" | "internalReferenceHeightM"> & {
  referenceGeometry: Nbc2025ReferenceGeometry;
};

export function nbc2025MainSurfacePressureEnvelopeFromGeometry(input: Nbc2025MainSurfaceEnvelopeGeometryInput) {
  const { referenceGeometry, ...pressureInput } = input;
  const referenceHeights = nbc2025ReferenceHeights(input.surface, input.buildingHeightM, referenceGeometry);
  return { referenceHeights, envelope: nbc2025MainSurfacePressureEnvelope({ ...pressureInput,
    externalReferenceHeightM: referenceHeights.externalReferenceHeightM,
    internalReferenceHeightM: referenceHeights.internalReferenceHeightM }) };
}
