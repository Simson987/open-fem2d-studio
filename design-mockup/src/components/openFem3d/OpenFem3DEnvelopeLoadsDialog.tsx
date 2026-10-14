import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Sheet from "../openaec/Sheet";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { ProjectInfo } from "../project/ProjectSettingsDialog";
import { generateWind3DLoads } from "./openFem3dWindGeneration";
import { generateRoofAndCladdingLoads } from "./openFem3dRoofLoads";
import type { Windgebied, TerreinCategorie } from "../../lib/wind/windEurocode";
import { NEDERLANDSE_WINDROUTE, requireWindCodeId, windCodeIdFromProjectInfo,
  type WindCodeId } from "../../lib/wind/windCodeRoute";
import "./OpenFem3DEnvelopeLoadsDialog.css";

export interface EnvelopeLoadInput {
  windCodeId?: WindCodeId;
  windgebied?: Windgebied;
  terreincategorie?: TerreinCategorie;
  manualPressureKnPerM2?: number;
  manualPressureSource?: string;
  structuralFactor?: number;
  backgroundPermeabilityFraction?: number;
  groundSnowKnPerM2?: number;
  snowExposure?: number;
  snowThermal?: number;
  imposedRoofKnPerM2?: number;
}

interface Props {
  open: boolean;
  model: OpenFem3DModel;
  projectInfo: ProjectInfo;
  onClose: () => void;
  onGenerate: (input: EnvelopeLoadInput) => Promise<void>;
}

/** Voorbeeld en wegschrijven gebruiken dezelfde zuivere generatoren. */
export default function OpenFem3DEnvelopeLoadsDialog({ open, model, projectInfo, onClose, onGenerate }: Props) {
  const { t } = useTranslation("ribbon");
  const projectWindCodeId = windCodeIdFromProjectInfo(projectInfo);
  const [wind, setWind] = useState(true);
  const [windgebied, setWindgebied] = useState<Windgebied>("II");
  const [terreincategorie, setTerreincategorie] = useState<TerreinCategorie>("II");
  const [manualPressure, setManualPressure] = useState(false);
  const [manualPressureKnPerM2, setManualPressureKnPerM2] = useState(0);
  const [manualPressureSource, setManualPressureSource] = useState("");
  const [structuralFactor, setStructuralFactor] = useState(1);
  const [backgroundPermeabilityPercent, setBackgroundPermeabilityPercent] = useState(0.1);
  const [groundSnowKnPerM2, setGroundSnowKnPerM2] = useState(0);
  const [snowExposure, setSnowExposure] = useState(1);
  const [snowThermal, setSnowThermal] = useState(1);
  const [imposedRoofKnPerM2, setImposedRoofKnPerM2] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setWindgebied(projectInfo.uitgangspunten?.windgebied ?? "II");
    setTerreincategorie(projectInfo.uitgangspunten?.terreincategorie ?? "II");
  }, [open, projectInfo.uitgangspunten?.windgebied, projectInfo.uitgangspunten?.terreincategorie]);
  const preview = useMemo(() => {
    if (!open) return null;
    try {
      const windLoads = wind ? generateWind3DLoads(model, { windCodeId: requireWindCodeId(projectWindCodeId),
        ...(manualPressure ? { manualPressureKnPerM2, manualPressureSource } : { windgebied, terreincategorie }),
        structuralFactor,
        backgroundPermeabilityFraction: backgroundPermeabilityPercent / 100 }) : null;
      const roof = generateRoofAndCladdingLoads(model, {
        groundSnowKnPerM2, snowExposure, snowThermal, imposedRoofKnPerM2,
      });
      const cases = [...(windLoads?.cases ?? []), ...roof.cases];
      const loads = [...(windLoads?.loads ?? []), ...roof.loads];
      const rows = new Map<string, { name: string; panelId: number; zone: string; area: number; force: number }>();
      const names = new Map(cases.map((item) => [item.key, item.name]));
      for (const load of loads) {
        const key = `${load.caseKey}:${load.panelId}:${load.zone}`;
        const old = rows.get(key);
        const [a, b, c] = load.triangle.points;
        const projectedArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
        const area = "direction" in load && load.direction === "gravity" ? projectedArea : load.triangle.areaM2;
        const force = ("qOutwardKnPerM2" in load ? load.qOutwardKnPerM2 : load.q) * area;
        rows.set(key, { name: names.get(load.caseKey) ?? load.caseKey,
          panelId: load.panelId, zone: load.zone,
          area: (old?.area ?? 0) + area,
          force: (old?.force ?? 0) + force });
      }
      return { cases: cases.length, panels: loads.length, rows: [...rows.values()],
        warnings: [...(windLoads?.warnings ?? []), ...roof.warnings], error: null };
    } catch (cause) {
      return { cases: 0, panels: 0, rows: [], warnings: [],
        error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [open, model, projectWindCodeId, wind, windgebied, terreincategorie, manualPressure,
    manualPressureKnPerM2, manualPressureSource, structuralFactor, backgroundPermeabilityPercent,
    groundSnowKnPerM2, snowExposure, snowThermal, imposedRoofKnPerM2]);

  const generate = async () => {
    if (!preview || preview.error || busy) return;
    const input: EnvelopeLoadInput = {
      ...(wind ? { windCodeId: requireWindCodeId(projectWindCodeId),
        ...(manualPressure ? { manualPressureKnPerM2, manualPressureSource } : { windgebied, terreincategorie }),
        structuralFactor, backgroundPermeabilityFraction: backgroundPermeabilityPercent / 100 } : {}),
      groundSnowKnPerM2, snowExposure, snowThermal, imposedRoofKnPerM2,
    };
    setBusy(true);
    setError(null);
    try { await onGenerate(input); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <Sheet open={open} title={t("openFem3d.envelopeLoads.title")} onClose={onClose} className="open-fem3d-envelope-sheet">
    <div className="oa-grid-form open-fem3d-envelope-loads">
      <label><input type="checkbox" checked={wind} onChange={(event) => setWind(event.target.checked)} /> {t("openFem3d.envelopeLoads.wind")}</label>
      {wind && <>
        <p>{projectWindCodeId === NEDERLANDSE_WINDROUTE
          ? t("openFem3d.envelopeLoads.windCode")
          : t("openFem3d.envelopeLoads.windCodeUnavailable", { code: projectWindCodeId })}</p>
        <label><input type="checkbox" checked={manualPressure} onChange={(event) => setManualPressure(event.target.checked)} /> {t("openFem3d.envelopeLoads.manualPressure")}</label>
        {manualPressure ? <>
          <label>{t("openFem3d.envelopeLoads.manualPressureValue")} <input type="number" min="0.001" step="0.01"
            value={manualPressureKnPerM2} onChange={(event) => setManualPressureKnPerM2(Number(event.target.value))} /></label>
          <label>{t("openFem3d.envelopeLoads.manualPressureSource")} <input type="text" maxLength={500}
            value={manualPressureSource} onChange={(event) => setManualPressureSource(event.target.value)} /></label>
        </> : <><label>{t("openFem3d.envelopeLoads.windZone")} <select value={windgebied} onChange={(event) => setWindgebied(event.target.value as Windgebied)}>
          {(["I", "II", "III"] as const).map((value) => <option key={value}>{value}</option>)}
        </select></label>
        <label>{t("openFem3d.envelopeLoads.terrain")} <select value={terreincategorie} onChange={(event) => setTerreincategorie(event.target.value as TerreinCategorie)}>
          {(["0", "I", "II", "III", "IV"] as const).map((value) => <option key={value}>{value}</option>)}
        </select></label></>}
        <label>{t("openFem3d.envelopeLoads.structural")} cₛ·c_d <input type="number" min="0.01" step="0.05" value={structuralFactor}
          onChange={(event) => setStructuralFactor(Number(event.target.value))} /></label>
        <label>{t("openFem3d.envelopeLoads.permeability")} <input type="number" min="0" max="1" step="0.01"
          value={backgroundPermeabilityPercent}
          onChange={(event) => setBackgroundPermeabilityPercent(Number(event.target.value))} /></label>
      </>}
      <label>{t("openFem3d.envelopeLoads.snow")} <input type="number" min="0" step="0.05" value={groundSnowKnPerM2}
        onChange={(event) => setGroundSnowKnPerM2(Number(event.target.value))} /></label>
      {groundSnowKnPerM2 > 0 && <>
        <label>{t("openFem3d.envelopeLoads.exposure")} Cₑ <input type="number" min="0.01" step="0.05" value={snowExposure}
          onChange={(event) => setSnowExposure(Number(event.target.value))} /></label>
        <label>{t("openFem3d.envelopeLoads.thermal")} Cₜ <input type="number" min="0.01" step="0.05" value={snowThermal}
          onChange={(event) => setSnowThermal(Number(event.target.value))} /></label>
      </>}
      <label>{t("openFem3d.envelopeLoads.imposed")} <input type="number" min="0" step="0.05" value={imposedRoofKnPerM2}
        onChange={(event) => setImposedRoofKnPerM2(Number(event.target.value))} /></label>
      <p>{t("openFem3d.envelopeLoads.claddingNote")}</p>
      {preview?.error && <p role="alert">{preview.error}</p>}
      {error && <p role="alert">{error}</p>}
      {preview && !preview.error && <>
        <strong>{t("openFem3d.envelopeLoads.summary", { cases: preview.cases, panels: preview.panels })}</strong>
        {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          <table className="oa-grid-table"><thead><tr><th>{t("openFem3d.envelopeLoads.case")}</th><th>{t("openFem3d.envelopeLoads.panel")}</th><th>{t("openFem3d.envelopeLoads.zone")}</th><th>{t("openFem3d.envelopeLoads.area")}</th><th>Σ qA kN</th></tr></thead>
            <tbody>{preview.rows.map((row, index) => <tr key={index}>
              <td>{row.name}</td><td>{row.panelId}</td><td>{row.zone}</td>
              <td>{row.area.toFixed(2)}</td><td>{row.force.toFixed(2)}</td>
            </tr>)}</tbody></table>
        </div>
      </>}
      <button type="button" disabled={busy || !preview || Boolean(preview.error) || preview.cases === 0} onClick={() => void generate()}>
        {busy ? t("openFem3d.envelopeLoads.busy") : t("openFem3d.envelopeLoads.generate")}
      </button>
    </div>
  </Sheet>;
}
