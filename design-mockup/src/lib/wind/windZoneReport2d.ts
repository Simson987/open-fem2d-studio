import type { LoadCase } from "../../components/fem/femTypes";
import type { VlakRegel } from "./windGenerator";

/** Read only saved generator data: current settings may no longer match the loads. */
export function windZoneReport2d(loadCase: LoadCase): { rows: VlakRegel[]; missing: boolean } | null {
  if (loadCase.gegenereerd?.bron !== "wind") return null;
  const value: unknown = loadCase.gegenereerd.windRegels;
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<VlakRegel>;
    return Number.isInteger(row.beamId) && (row.beamId ?? 0) > 0
      && typeof row.zone === "string" && row.zone.length > 0
      && typeof row.rol === "string" && typeof row.bron === "string"
      && Number.isFinite(row.cpe) && Number.isFinite(row.cpi)
      && Number.isFinite(row.w_kNm2) && Number.isFinite(row.q_kNm)
      && (row.startFrac === undefined || Number.isFinite(row.startFrac))
      && (row.endFrac === undefined || Number.isFinite(row.endFrac));
  })) return { rows: [], missing: true };
  return { rows: value as VlakRegel[], missing: false };
}
