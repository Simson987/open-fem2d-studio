import type { NbcImportanceCategory, NbcLimitState } from "./nbc2025StaticWind";

export const NBC_2025_SNOW_SOURCE =
  "NBC 2025 Vol. 1, Division B, 4.1.6.2–4.1.6.3, https://doi.org/10.4224/26fz-gg26";

export interface Nbc2025FlatRoofSnowInput {
  widthXM: number;
  widthYM: number;
  groundSnowKPa: number;
  groundSnowSource: string;
  associatedRainKPa: number;
  associatedRainSource: string;
  windExposureFactor: number;
  windExposureSource: string;
  thermalFactor: number;
  thermalFactorSource: string;
  importanceCategory: NbcImportanceCategory;
  /** Other accumulation cases in 4.1.6.2(8) have been ruled out for this roof. */
  noAdditionalAccumulation: true;
  accumulationEvidenceSource: string;
}

export interface Nbc2025SnowPressure {
  limitState: NbcLimitState;
  importanceFactor: number;
  basicRoofFactor: number;
  characteristicLengthM: number;
  pressureKPa: number;
  source: typeof NBC_2025_SNOW_SOURCE;
}

const IMPORTANCE: Record<NbcLimitState, Record<NbcImportanceCategory, number>> = {
  uls: { low: 0.8, normal: 1, high: 1.15, "post-disaster": 1.25 },
  sls: { low: 0.6, normal: 0.6, high: 0.6, "post-disaster": 0.6 },
};

/** Uniform flat-roof pressure. Partial distributions are applied separately. */
export function nbc2025FlatRoofSnowPressure(
  input: Nbc2025FlatRoofSnowInput, limitState: NbcLimitState,
): Nbc2025SnowPressure {
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  const source = (value: string) => typeof value === "string" && Boolean(value.trim());
  if (!positive(input.widthXM) || !positive(input.widthYM) || !positive(input.groundSnowKPa)
    || !Number.isFinite(input.associatedRainKPa) || input.associatedRainKPa < 0
    || !positive(input.windExposureFactor) || !Number.isFinite(input.thermalFactor)
    || input.thermalFactor < 0.7 || input.thermalFactor > 1
    || !source(input.groundSnowSource) || !source(input.associatedRainSource)
    || !source(input.windExposureSource) || !source(input.thermalFactorSource)
    || input.noAdditionalAccumulation !== true || !source(input.accumulationEvidenceSource)) {
    throw new Error("NBC-sneeuw vraagt eindige dak- en klimaatwaarden met bron en uitsluiting van extra ophoping.");
  }
  const importanceFactor = IMPORTANCE[limitState]?.[input.importanceCategory];
  if (!importanceFactor) throw new Error("Onbekende NBC-belangcategorie of grenstoestand voor sneeuw.");
  if ((input.importanceCategory === "high" || input.importanceCategory === "post-disaster")
    && input.windExposureFactor < 1) {
    throw new Error("NBC-sneeuw vraagt C_w ≥ 1 voor hoge en post-disaster-belangcategorieën.");
  }
  const width = Math.min(input.widthXM, input.widthYM);
  const length = Math.max(input.widthXM, input.widthYM);
  const characteristicLengthM = 2 * width - width * width / length;
  const basicRoofFactor = characteristicLengthM <= 70 ? 0.8
    : 1 - 0.2 * Math.exp(-(characteristicLengthM - 70) / 100);
  const snowPart = input.groundSnowKPa * basicRoofFactor * input.windExposureFactor * input.thermalFactor;
  if (input.associatedRainKPa > snowPart + 1e-9) {
    throw new Error("De NBC-bijbehorende regenlast S_r mag de berekende sneeuwcomponent niet overschrijden.");
  }
  return { limitState, importanceFactor, basicRoofFactor, characteristicLengthM,
    pressureKPa: importanceFactor * (snowPart + input.associatedRainKPa), source: NBC_2025_SNOW_SOURCE };
}
