import type { CheckStatus } from "../../lib/types/steel/CheckStatus";
import type { Frame3DConcreteChecks } from "./frame3dConcreteCheck";
import type { Frame3DSteelChecks } from "./frame3dSteelCheck";
import { frame3DUlsUc } from "./frame3dSteelCheck";

export interface Frame3DUtilization {
  beamId: number;
  uc: number;
  status: CheckStatus;
  standard: "EN 1992" | "EN 1993";
}

/** Eén materiaalneutrale resultaatlaag voor staal- en betonstaven. */
export function buildFrame3DUtilizations(
  steel: Frame3DSteelChecks | null | undefined,
  concrete: Frame3DConcreteChecks | null | undefined,
): Frame3DUtilization[] {
  const values = new Map<number, Frame3DUtilization>();
  for (const result of steel?.results ?? []) {
    values.set(result.beam_id, {
      beamId: result.beam_id,
      uc: frame3DUlsUc(result),
      status: result.status,
      standard: "EN 1993",
    });
  }
  for (const result of concrete?.results ?? []) {
    values.set(result.beam_id, {
      beamId: result.beam_id,
      uc: result.uc_max,
      status: result.status,
      standard: "EN 1992",
    });
  }
  return [...values.values()].sort((a, b) => a.beamId - b.beamId);
}

/** Zelfde vaste klassen voor materiaal, legenda en geautomatiseerde tests. */
export function frame3DUtilizationClass(value: Frame3DUtilization):
  "not-applicable" | "low" | "medium" | "high" | "fail" {
  if (value.status === "NotApplicable" || !Number.isFinite(value.uc)) return "not-applicable";
  if (value.status === "NotOk" || value.uc > 1) return "fail";
  if (value.uc > 0.8) return "high";
  if (value.uc > 0.5) return "medium";
  return "low";
}

export const FRAME_3D_UTILIZATION_COLORS: Record<ReturnType<typeof frame3DUtilizationClass>, number> = {
  "not-applicable": 0x64748b,
  low: 0x16a34a,
  medium: 0x84cc16,
  high: 0xf59e0b,
  fail: 0xdc2626,
};
