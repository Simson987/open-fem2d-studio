import type { Load, LoadCase } from "../../components/fem/femTypes";
import type { StuwdrukResultaat } from "./windEurocode";
import { NEDERLANDSE_WINDROUTE } from "./windCodeRoute";

export interface WindPressureSource2D {
  windCodeId: string;
  pressure: StuwdrukResultaat;
  cases: string[];
  beams: number[];
}

function validPressure(value: unknown): value is StuwdrukResultaat {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<StuwdrukResultaat>;
  return Number.isFinite(p.qp_kNm2) && Number.isFinite(p.ze_m)
    && typeof p.handmatig === "boolean" && Array.isArray(p.afleiding)
    && p.afleiding.length > 0 && p.afleiding.every((line) =>
      line && typeof line.symbool === "string" && typeof line.waarde === "string"
        && typeof line.bron === "string");
}

/** Show the pressure saved with the load, never recompute it from current project settings. */
export function windPressureReport2d(loadCases: readonly LoadCase[], loads: readonly Load[]): {
  sources: WindPressureSource2D[];
  missingCases: string[];
} {
  const sources = new Map<string, WindPressureSource2D>();
  const missingCases: string[] = [];
  const add = (windCodeId: string, pressure: StuwdrukResultaat, caseName?: string, beamId?: number) => {
    const key = JSON.stringify([windCodeId, pressure]);
    let source = sources.get(key);
    if (!source) {
      source = { windCodeId, pressure, cases: [], beams: [] };
      sources.set(key, source);
    }
    if (caseName && !source.cases.includes(caseName)) source.cases.push(caseName);
    if (beamId !== undefined && !source.beams.includes(beamId)) source.beams.push(beamId);
  };
  for (const loadCase of loadCases) {
    if (loadCase.gegenereerd?.bron !== "wind") continue;
    const pressure = loadCase.gegenereerd.windStuwdruk;
    const codeId = loadCase.gegenereerd.windCodeId ?? NEDERLANDSE_WINDROUTE;
    if (validPressure(pressure)) add(codeId, pressure, loadCase.name);
    else missingCases.push(loadCase.name);
    for (const load of loads) {
      if (load.caseId !== loadCase.id || load.gegenereerdDoor !== "wind"
        || !validPressure(load.windStuwdruk)) continue;
      add(codeId, load.windStuwdruk, undefined, load.beamId);
    }
  }
  return { sources: [...sources.values()], missingCases };
}
