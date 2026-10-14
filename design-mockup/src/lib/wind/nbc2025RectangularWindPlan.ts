import {
  nbc2025MainSurfacePressureFromGeometry,
  type Nbc2025MainSurfaceEnvelopeGeometryInput,
  type Nbc2025ReferenceHeights,
} from "./nbc2025ReferenceHeights";
import type { Nbc2025StaticPressureResult, NbcLimitState, NbcMainSurface } from "./nbc2025StaticWind";
import { createWindSurfacePressurePlan, type WindSurfacePressurePlan } from "./windSurfacePressurePlan";
import { nbc2025InternalPressureRange, type Nbc2025OpeningEvidence } from "./nbc2025InternalPressure";

export type NbcWindDirection = "+X" | "-X" | "+Y" | "-Y";
export type NbcWindVector = readonly [number, number, number];

export interface NbcRectangularPatch {
  surface: NbcMainSurface;
  /** The rectangle lies in one of the six planes of the building envelope. */
  boundsM: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  areaM2: number;
  outwardNormal: NbcWindVector;
  pressurePlan: WindSurfacePressurePlan;
  pressureDerivation: Nbc2025StaticPressureResult;
  referenceHeights: Nbc2025ReferenceHeights;
  /** Applied force, in global coordinates, before load combinations. */
  resultantKn: NbcWindVector;
}

export interface NbcRectangularWindCase {
  key: string;
  limitState: NbcLimitState;
  direction: NbcWindDirection;
  internalPressureCoefficient: number;
  patches: NbcRectangularPatch[];
}

export interface NbcFrameStripLoad {
  caseKey: string;
  surfaceId: string;
  /** Length along the frame member, before its local-axis transformation. */
  lengthM: number;
  /** Load per metre of member in global coordinates. */
  lineForceKnPerM: NbcWindVector;
  resultantKn: NbcWindVector;
}

/**
 * Static main-system procedure for a rectangular, flat-roofed low building.
 * q, Cpi and Ct must be supplied with their source; this does not select an
 * applicable provincial code or provide licensed climatic/map data.
 */
type NbcRectangularWindPlanBasis = Omit<Nbc2025MainSurfaceEnvelopeGeometryInput,
  "surface" | "buildingHeightM" | "parallelPlanWidthM" | "roofDistanceFromUpwindM" | "referenceGeometry"
  | "limitState"
  | "internalPressureCoefficientMin" | "internalPressureCoefficientMax" | "internalCoefficientSource"> & {
  widthXM: number;
  widthYM: number;
  heightM: number;
  /** 4.1.7.1–2: static procedure is unavailable for dynamic or wake effects. */
  naturalFrequencyHz: number;
  naturalFrequencySource: string;
  noWakeOrChannelling: true;
};

export type NbcRectangularWindBuildingInput = NbcRectangularWindPlanBasis & (
  | { openingEvidence: Nbc2025OpeningEvidence; internalPressureCoefficientMin?: never;
      internalPressureCoefficientMax?: never; internalCoefficientSource?: never }
  | { openingEvidence?: never; internalPressureCoefficientMin: number;
      internalPressureCoefficientMax: number; internalCoefficientSource: string }
);

export type NbcRectangularWindPlanInput = NbcRectangularWindBuildingInput & { limitState: NbcLimitState };

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} moet positief en eindig zijn.`);
  return value;
}

function source(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} mist een bron.`);
}

export function nbc2025RectangularWindPlan(input: NbcRectangularWindPlanInput): NbcRectangularWindCase[] {
  const widthX = positive(input.widthXM, "Gebouwmaat X");
  const widthY = positive(input.widthYM, "Gebouwmaat Y");
  const height = positive(input.heightM, "Gebouwhoogte");
  if (height > 20 || height >= Math.min(widthX, widthY)) {
    throw new Error("Dit NBC-plan ondersteunt alleen gebouwen met H ≤ 20 m en H kleiner dan beide plattegrondmaten.");
  }
  if (positive(input.naturalFrequencyHz, "Laagste eigenfrequentie") < 1
    || input.noWakeOrChannelling !== true) {
    throw new Error("NBC 2025 vereist hier een geverifieerde niet-dynamische situatie zonder wake- of kanaaleffect.");
  }
  source(input.naturalFrequencySource, "Laagste eigenfrequentie");
  const classified = input.openingEvidence === undefined ? undefined
    : nbc2025InternalPressureRange(input.openingEvidence);
  if (classified && (input.internalPressureCoefficientMin !== undefined
    || input.internalPressureCoefficientMax !== undefined || input.internalCoefficientSource !== undefined)) {
    throw new Error("Kies óf een NBC 2025-openingsklasse óf handmatig onderbouwde C_pi-grenzen.");
  }
  const min = classified?.minimum ?? input.internalPressureCoefficientMin;
  const max = classified?.maximum ?? input.internalPressureCoefficientMax;
  const internalCoefficientSource = classified?.source ?? input.internalCoefficientSource;
  if (typeof min !== "number" || typeof max !== "number"
    || !Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new Error("Binnendrukgrenzen moeten eindig en oplopend zijn.");
  }
  if (typeof internalCoefficientSource !== "string") {
    throw new Error("Binnendrukcoëfficiënt mist een bron.");
  }
  source(internalCoefficientSource, "Binnendrukcoëfficiënt");
  const coefficients = min === max ? [min] : [min, max];
  const directions: NbcWindDirection[] = ["+X", "-X", "+Y", "-Y"];
  return directions.flatMap((direction) => coefficients.map((cpi) => {
    const alongX = direction.endsWith("X");
    const positiveDirection = direction.startsWith("+");
    const parallelWidth = alongX ? widthX : widthY;
    const caseKey = `nbc2025:${input.limitState}:${direction}:cpi:${cpi}`;
    const patches: NbcRectangularPatch[] = [];
    const add = (surfaceId: string, surface: NbcMainSurface,
      boundsM: NbcRectangularPatch["boundsM"], outwardNormal: NbcWindVector,
      areaM2: number, roofDistanceFromUpwindM?: number) => {
      const { pressure, referenceHeights } = nbc2025MainSurfacePressureFromGeometry({
        ...input, surface, buildingHeightM: height, parallelPlanWidthM: parallelWidth,
        roofDistanceFromUpwindM, internalPressureCoefficient: cpi,
        internalCoefficientSource,
        referenceGeometry: { smallerPlanDimensionM: Math.min(widthX, widthY),
          roofMidHeightM: height, buildingMidHeightM: height / 2,
          hasDominantOpening: false },
      });
      const pressurePlan = createWindSurfacePressurePlan({
        codeId: "ca-nbc-2025", caseKey, surfaceId, zone: surfaceId,
        source: `${pressure.externalCoefficientSource}; ${pressure.internalCoefficientSource}`,
        basis: { kind: "separate-pressures", externalPressureKnPerM2: pressure.externalPressureKPa,
          internalPressureKnPerM2: pressure.internalPressureKPa },
      });
      const force = pressurePlan.pressure.outwardKnPerM2 * areaM2;
      const resultantKn: NbcWindVector = [
        outwardNormal[0] * force, outwardNormal[1] * force, outwardNormal[2] * force,
      ];
      patches.push({ surface, boundsM, areaM2, outwardNormal, pressurePlan,
        pressureDerivation: pressure, referenceHeights, resultantKn });
    };
    if (alongX) {
      add("x-min-wall", positiveDirection ? "windward" : "leeward",
        { x0: 0, x1: 0, y0: 0, y1: widthY, z0: 0, z1: height }, [-1, 0, 0], widthY * height);
      add("x-max-wall", positiveDirection ? "leeward" : "windward",
        { x0: widthX, x1: widthX, y0: 0, y1: widthY, z0: 0, z1: height }, [1, 0, 0], widthY * height);
      add("y-min-wall", "parallelWall",
        { x0: 0, x1: widthX, y0: 0, y1: 0, z0: 0, z1: height }, [0, -1, 0], widthX * height);
      add("y-max-wall", "parallelWall",
        { x0: 0, x1: widthX, y0: widthY, y1: widthY, z0: 0, z1: height }, [0, 1, 0], widthX * height);
    } else {
      add("y-min-wall", positiveDirection ? "windward" : "leeward",
        { x0: 0, x1: widthX, y0: 0, y1: 0, z0: 0, z1: height }, [0, -1, 0], widthX * height);
      add("y-max-wall", positiveDirection ? "leeward" : "windward",
        { x0: 0, x1: widthX, y0: widthY, y1: widthY, z0: 0, z1: height }, [0, 1, 0], widthX * height);
      add("x-min-wall", "parallelWall",
        { x0: 0, x1: 0, y0: 0, y1: widthY, z0: 0, z1: height }, [-1, 0, 0], widthY * height);
      add("x-max-wall", "parallelWall",
        { x0: widthX, x1: widthX, y0: 0, y1: widthY, z0: 0, z1: height }, [1, 0, 0], widthY * height);
    }
    const nearStart = positiveDirection ? 0 : parallelWidth - height;
    const farStart = positiveDirection ? height : 0;
    const roofBounds = (from: number, to: number): NbcRectangularPatch["boundsM"] => alongX
      ? { x0: from, x1: to, y0: 0, y1: widthY, z0: height, z1: height }
      : { x0: 0, x1: widthX, y0: from, y1: to, z0: height, z1: height };
    add("roof-upwind", "roof", roofBounds(nearStart, nearStart + height), [0, 0, 1],
      height * (alongX ? widthY : widthX), height / 2);
    add("roof-downwind", "roof", roofBounds(farStart, farStart + parallelWidth - height), [0, 0, 1],
      (parallelWidth - height) * (alongX ? widthY : widthX), (height + parallelWidth) / 2);
    return { key: caseKey, limitState: input.limitState, direction, internalPressureCoefficient: cpi, patches };
  }));
}

/** Project one transverse strip of the same pressure plan onto a vertical 2D frame. */
export function nbc2025FrameStripLoads(
  windCase: NbcRectangularWindCase, transverseFromM: number, transverseToM: number,
): NbcFrameStripLoad[] {
  const alongX = windCase.direction.endsWith("X");
  const roof = windCase.patches.find((patch) => patch.surface === "roof");
  if (!roof) throw new Error("NBC-windgeval mist een dakvlak.");
  const crosswindWidth = alongX ? roof.boundsM.y1 - roof.boundsM.y0 : roof.boundsM.x1 - roof.boundsM.x0;
  if (!Number.isFinite(transverseFromM) || !Number.isFinite(transverseToM)
    || transverseFromM < 0 || transverseToM > crosswindWidth
    || transverseToM <= transverseFromM) {
    throw new Error("2D-spantstrook ligt niet binnen de gebouwbreedte.");
  }
  const stripWidth = transverseToM - transverseFromM;
  return windCase.patches.filter((patch) => patch.surface !== "parallelWall").map((patch) => {
    const lengthM = patch.surface === "roof"
      ? alongX ? patch.boundsM.x1 - patch.boundsM.x0 : patch.boundsM.y1 - patch.boundsM.y0
      : patch.boundsM.z1 - patch.boundsM.z0;
    const q = patch.pressurePlan.pressure.outwardKnPerM2 * stripWidth;
    const lineForceKnPerM: NbcWindVector = [
      patch.outwardNormal[0] * q, patch.outwardNormal[1] * q, patch.outwardNormal[2] * q,
    ];
    return { caseKey: windCase.key, surfaceId: patch.pressurePlan.surfaceId, lengthM,
      lineForceKnPerM, resultantKn: [lineForceKnPerM[0] * lengthM,
        lineForceKnPerM[1] * lengthM, lineForceKnPerM[2] * lengthM] };
  });
}
