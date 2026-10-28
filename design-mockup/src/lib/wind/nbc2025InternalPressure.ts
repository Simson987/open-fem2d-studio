/** NBC 2025, Division B, Table 4.1.7.7: building internal pressure classes. */
export const NBC_2025_INTERNAL_PRESSURE_SOURCE =
  "NBC 2025 Vol. 1, Division B, Table 4.1.7.7, https://doi.org/10.4224/26fz-gg26";

export type Nbc2025OpeningEvidence =
  | { kind: "uniform-small"; openingAreaFraction: number; uniformlyDistributed: true; source: string }
  | { kind: "other-or-closed"; nonUniformlyDistributed?: true; noSignificantOpening?: true;
      significantOpeningsWindResistantAndStormClosed?: true; source: string }
  | { kind: "large-open"; likelyOpenDuringStorm: true; source: string };

export interface Nbc2025InternalPressureRange {
  minimum: number;
  maximum: number;
  source: string;
}

/** The opening classification is a project assertion; its evidence travels with every pressure case. */
export function nbc2025InternalPressureRange(input: Nbc2025OpeningEvidence): Nbc2025InternalPressureRange {
  if (!input || typeof input !== "object" || typeof input.source !== "string" || !input.source.trim()) {
    throw new Error("NBC 2025-binnendrukklasse mist een herleidbare bron.");
  }
  let minimum: number;
  let maximum: number;
  if (input.kind === "uniform-small") {
    if (input.uniformlyDistributed !== true || !Number.isFinite(input.openingAreaFraction)
      || input.openingAreaFraction < 0 || input.openingAreaFraction >= 0.001) {
      throw new Error("Kleine uniforme openingen moeten gelijkmatig verdeeld zijn en minder dan 0,1% beslaan.");
    }
    minimum = -0.15; maximum = 0;
  } else if (input.kind === "other-or-closed") {
    if ((input.nonUniformlyDistributed !== true || input.noSignificantOpening !== true)
      && input.significantOpeningsWindResistantAndStormClosed !== true) {
      throw new Error("Onderbouw niet-uniforme openingen zonder significante opening of stormvast gesloten significante openingen.");
    }
    minimum = -0.45; maximum = 0.3;
  } else if (input.kind === "large-open") {
    if (input.likelyOpenDuringStorm !== true) {
      throw new Error("Grote openingen moeten tijdens een storm waarschijnlijk open blijven.");
    }
    minimum = -0.7; maximum = 0.7;
  } else {
    throw new Error("NBC 2025-binnendrukklasse is onbekend.");
  }
  return { minimum, maximum,
    source: `${NBC_2025_INTERNAL_PRESSURE_SOURCE} [${input.kind}]; ${input.source.trim()}` };
}
