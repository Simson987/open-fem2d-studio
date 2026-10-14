import type { CheckStatus } from "../../lib/types/steel/CheckStatus";
import type { OpenFem3DConcreteChecks } from "./openFem3dConcreteCheck";
import type { OpenFem3DSteelChecks } from "./openFem3dSteelCheck";
import { openFem3DTimberUlsUc, type OpenFem3DTimberChecks } from "./openFem3dTimberCheck";
import { openFem3DUlsUc } from "./openFem3dSteelCheck";

export interface OpenFem3DUtilization {
  beamId: number;
  uc: number;
  status: CheckStatus;
  standard: "EN 1992" | "EN 1993" | "EN 1995";
}

/** Eén materiaalneutrale resultaatlaag voor staal- en betonstaven. */
export function buildOpenFem3DUtilizations(
  steel: OpenFem3DSteelChecks | null | undefined,
  concrete: OpenFem3DConcreteChecks | null | undefined,
  timber?: OpenFem3DTimberChecks | null,
): OpenFem3DUtilization[] {
  const values = new Map<number, OpenFem3DUtilization>();
  for (const result of steel?.results ?? []) {
    values.set(result.beam_id, {
      beamId: result.beam_id,
      uc: openFem3DUlsUc(result),
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
  for (const result of timber?.results ?? []) {
    const uls = result.checks.filter((check) => !check.id.startsWith("deflection_") && !check.id.startsWith("sls_") && check.kind.data.uc);
    const uc = openFem3DTimberUlsUc(result);
    values.set(result.beam_id, {
      beamId: result.beam_id, uc,
      status: uls.length === 0 ? "NotApplicable" : uc > 1 ? "NotOk" : "Ok",
      standard: "EN 1995",
    });
  }
  return [...values.values()].sort((a, b) => a.beamId - b.beamId);
}

/** Zelfde vaste klassen voor materiaal, legenda en geautomatiseerde tests. */
export function openFem3DUtilizationClass(value: OpenFem3DUtilization):
  "not-applicable" | "low" | "medium" | "high" | "fail" {
  if (value.status === "NotApplicable" || !Number.isFinite(value.uc)) return "not-applicable";
  if (value.status === "NotOk" || value.uc > 1) return "fail";
  if (value.uc > 0.8) return "high";
  if (value.uc > 0.5) return "medium";
  return "low";
}

export const OPEN_FEM_3D_UTILIZATION_COLORS: Record<ReturnType<typeof openFem3DUtilizationClass>, number> = {
  "not-applicable": 0x64748b,
  low: 0x16a34a,
  medium: 0x84cc16,
  high: 0xf59e0b,
  fail: 0xdc2626,
};
