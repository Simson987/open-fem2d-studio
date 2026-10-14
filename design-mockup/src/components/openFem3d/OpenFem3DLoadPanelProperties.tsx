import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { removeOpenFem3DLoadPanel, type OpenFem3DModel, type OpenFem3DVector } from "./openFem3dModel";
import {
  analyseOpenFem3DLoadPanels,
  duplicateOpenFem3DLoadPanel,
  openFem3DLoadPanelGeometry,
  updateOpenFem3DLoadPanel,
  type OpenFem3DLoadPanelPatch,
} from "./openFem3dLoadPanels";
import { toonMm } from "../../lib/lengthInput";

interface Props {
  model: OpenFem3DModel;
  panelId: number;
  onChange: (model: OpenFem3DModel) => void;
  /** Start het kiezen van de overspanning in de tekening (twee knopen of één staaf). */
  onPickSpanDirection?: (panelId: number) => void;
  spanPickActive?: boolean;
  loadCaseOptions?: readonly { id: number; name: string }[];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fem-prop-row"><span className="fem-prop-label">{label}</span><span className="fem-prop-value">{children}</span></div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="fem-prop-section"><div className="fem-prop-section-title">{title}</div>{children}</section>;
}

const number = (value: number, digits = 3) =>
  Number.isFinite(value) ? value.toLocaleString("nl-NL", { maximumFractionDigits: digits }) : "—";

type SpanChoice = "x" | "y" | "z" | "custom";
const AXES: Record<Exclude<SpanChoice, "custom">, OpenFem3DVector> = {
  x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 },
};

function spanChoice(vector: OpenFem3DVector | undefined): SpanChoice {
  if (!vector) return "x";
  const length = Math.hypot(vector.x, vector.y, vector.z);
  for (const axis of ["x", "y", "z"] as const) {
    if (Math.abs(Math.abs(vector[axis]) - length) <= 1e-12 * length) return axis;
  }
  return "custom";
}

/**
 * Eigenschappen van één belastingvlak: q, geval, lastrichting, afdracht en
 * overspanning, de liggers in het vlak (met uitsluiten) en de afgeleide
 * lijnlasten zoals ze naar de rekenkern gaan.
 */
export default function OpenFem3DLoadPanelProperties({
  model, panelId, onChange, onPickSpanDirection, spanPickActive = false, loadCaseOptions = [],
}: Props) {
  const { t } = useTranslation("ribbon");
  const panel = (model.loadPanels ?? []).find((item) => item.id === panelId);
  const analysis = useMemo(
    () => analyseOpenFem3DLoadPanels(model).find((item) => item.panel.id === panelId),
    [model, panelId],
  );
  const geometry = useMemo(() => {
    if (!panel) return null;
    try {
      return openFem3DLoadPanelGeometry(model, panel);
    } catch {
      return null;
    }
  }, [model, panel]);
  const [error, setError] = useState("");
  const [duplicateCaseId, setDuplicateCaseId] = useState<number | null>(null);
  if (!panel) return null;
  const result = analysis?.result;
  const caseId = panel.caseId ?? 1;
  const caseName = loadCaseOptions.find((item) => item.id === caseId)?.name;
  const apply = (patch: OpenFem3DLoadPanelPatch) => {
    try {
      onChange(updateOpenFem3DLoadPanel(model, panel.id, patch));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const choice = spanChoice(panel.spanDirection);
  // Lijnlast in de lastrichting: q × (1 of |n_z|) × belastingbreedte.
  const factor = panel.direction === "gravity" ? Math.abs(geometry?.normal[2] ?? 1) : 1;
  const pOf = (width: number) => panel.q * factor * width;
  const roles = new Map<number, string>();
  if (result) {
    for (const id of result.receiverBeamIds) roles.set(id, panel.distribution === "oneWay" ? t("openFem3d.loadPanel.roleTransverse") : t("openFem3d.loadPanel.roleCarries"));
    for (const id of result.parallelBeamIds) roles.set(id, t("openFem3d.loadPanel.roleParallel"));
    for (const id of result.skewBeamIds) roles.set(id, t("openFem3d.loadPanel.roleSkew"));
    for (const id of result.excludedBeamIds) roles.set(id, t("openFem3d.loadPanel.roleExcluded"));
  }
  const listedBeamIds = result ? [...result.inPanelBeamIds].sort((a, b) => a - b) : [...(panel.excludedBeamIds ?? [])];
  const excluded = new Set(panel.excludedBeamIds ?? []);
  const totalKn = result ? Math.hypot(...result.totalForceKn) * Math.sign(panel.q) : NaN;
  const assignedKn = result
    ? (result.beamLoads.reduce((sum, item) => sum + item.areaM2, 0)
      + result.pointShares.reduce((sum, item) => sum + item.areaM2, 0)) * panel.q * factor
    : NaN;

  return <div className="open-fem3d-load-panel-properties" data-open-fem3d-load-panel={panel.id}>
    <Section title={t("openFem3d.loadPanel.geometry")}>
      <Row label="ID"><code>{panel.id}</code></Row>
      <Row label={t("openFem3d.loadPanel.corners")}><code>{panel.nodeIds.map((id) => `K${id}`).join(" · ")}</code></Row>
      {geometry && <>
        <Row label={t("openFem3d.loadPanel.area")}><code>{number(geometry.areaM2)} m²</code></Row>
        <Row label={t("openFem3d.loadPanel.projectedArea")}><code>{number(geometry.projectedAreaM2)} m²</code></Row>
      </>}
      <Row label={t("openFem3d.loadPanel.loadCase")}><code>{caseName ? `${caseId} · ${caseName}` : caseId}</code></Row>
    </Section>

    <Section title={t("openFem3d.loadPanel.load")}>
      <Row label={t("openFem3d.loadPanel.q")}>
        <input className="fem-prop-input" type="number" step="any" defaultValue={panel.q}
          key={`q-${panel.id}-${panel.q}`}
          onBlur={(event) => {
            const next = Number(event.currentTarget.value);
            if (next !== panel.q) apply({ q: next });
          }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </Row>
      <Row label={t("openFem3d.loadPanel.direction")}>
        <select className="fem-prop-input" value={panel.direction}
          onChange={(event) => apply({ direction: event.target.value as typeof panel.direction })}>
          <option value="gravity">{t("openFem3d.loadPanel.gravity")}</option>
          <option value="normal">{t("openFem3d.loadPanel.normal")}</option>
          <option value="verticalSurface">{t("openFem3d.loadPanel.verticalSurface")}</option>
        </select>
      </Row>
      {panel.direction === "normal" && geometry && <p className="fem-prop-hint">{t("openFem3d.loadPanel.normalHint", {
        x: number(geometry.normal[0]), y: number(geometry.normal[1]), z: number(geometry.normal[2]),
      })}</p>}
      <div className="fem-prop-kiezer-row">
        <button type="button" className="fem-prop-kiezer-btn" onClick={() => apply({ q: -panel.q })}>{t("openFem3d.loadPanel.flip")}</button>
      </div>
      {result && <Row label={t("openFem3d.loadPanel.resultant")}><code>{t("openFem3d.loadPanel.resultantValue", {
        x: number(result.totalForceKn[0]), y: number(result.totalForceKn[1]), z: number(result.totalForceKn[2]),
      })}</code></Row>}
    </Section>

    <Section title={t("openFem3d.loadPanel.distribution")}>
      <Row label={t("openFem3d.loadPanel.distribution")}>
        <select className="fem-prop-input" value={panel.distribution}
          onChange={(event) => apply({ distribution: event.target.value as typeof panel.distribution })}>
          <option value="twoWay">{t("openFem3d.loadPanel.twoWay")}</option>
          <option value="oneWay">{t("openFem3d.loadPanel.oneWay")}</option>
        </select>
      </Row>
      {panel.distribution === "oneWay" && <>
        <Row label={t("openFem3d.loadPanel.span")}>
          <select className="fem-prop-input" value={choice}
            onChange={(event) => {
              const next = event.target.value as SpanChoice;
              if (next === "custom") onPickSpanDirection?.(panel.id);
              else apply({ spanDirection: AXES[next] });
            }}>
            <option value="x">{t("openFem3d.loadPanel.spanX")}</option>
            <option value="y">{t("openFem3d.loadPanel.spanY")}</option>
            <option value="z">{t("openFem3d.loadPanel.spanZ")}</option>
            <option value="custom">{t("openFem3d.loadPanel.spanCustom")}</option>
          </select>
        </Row>
        {panel.spanDirection && <Row label={t("openFem3d.loadPanel.spanVectorLabel")}><code>{t("openFem3d.loadPanel.spanVector", {
          x: number(panel.spanDirection.x), y: number(panel.spanDirection.y), z: number(panel.spanDirection.z),
        })}</code></Row>}
        <div className="fem-prop-kiezer-row">
          <button type="button" className="fem-prop-kiezer-btn" aria-pressed={spanPickActive}
            onClick={() => onPickSpanDirection?.(panel.id)} disabled={!onPickSpanDirection}>
            {t("openFem3d.loadPanel.pickSpan")}
          </button>
        </div>
        {spanPickActive && <p className="fem-prop-hint">{t("openFem3d.loadPanelSpanHelp")}</p>}
      </>}
    </Section>

    <Section title={t("openFem3d.loadPanel.beams")}>
      {listedBeamIds.length === 0 && <p className="fem-prop-hint">{t("openFem3d.loadPanel.noBeams")}</p>}
      {listedBeamIds.length > 0 && <div className="open-fem3d-release-grid">
        {listedBeamIds.map((beamId) => <label key={beamId} title={roles.get(beamId)}>
          <input type="checkbox" checked={!excluded.has(beamId)} onChange={(event) => {
            const next = event.target.checked
              ? [...excluded].filter((id) => id !== beamId)
              : [...excluded, beamId];
            apply({ excludedBeamIds: next });
          }} />
          <span>{t("openFem3d.loadPanel.beamRole", { id: beamId, role: roles.get(beamId) ?? "" })}</span>
        </label>)}
      </div>}
      <p className="fem-prop-hint">{t("openFem3d.loadPanel.beamsHint")}</p>
    </Section>

    <Section title={t("openFem3d.loadPanel.derived")}>
      {analysis?.error && <p className="open-fem3d-error" role="alert">{analysis.error}</p>}
      {result && <>
        <p className="fem-prop-hint">{t("openFem3d.loadPanel.derivedHint")}</p>
        <div className="open-fem3d-check-list">
          {result.beamLoads.flatMap((beamLoad) => beamLoad.pieces.map((piece, index) =>
            <div key={`${beamLoad.beamId}-${index}`}>
              <span>{t("openFem3d.loadPanel.derivedRow", {
                beam: beamLoad.beamId,
                from: toonMm(piece.startPositionM, "m"), to: toonMm(piece.endPositionM, "m"),
              })}</span>
              <code>{number(pOf(piece.widthStartM))} → {number(pOf(piece.widthEndM))}</code>
            </div>))}
          {result.pointShares.map((share, index) => <div key={`point-${index}`}>
            <span>{share.nodeId !== undefined
              ? t("openFem3d.loadPanel.nodeShare", { node: share.nodeId })
              : t("openFem3d.loadPanel.beamShare", { beam: share.beamId, position: toonMm(share.positionM ?? 0, "m") })}</span>
            <code>{number(share.areaM2 * panel.q * factor)} kN</code>
          </div>)}
        </div>
        <p className="fem-prop-hint">{t("openFem3d.loadPanel.total", { sum: number(assignedKn), expected: number(totalKn) })}</p>
      </>}
      {result && result.warnings.length > 0 && <ul className="open-fem3d-load-panel-warnings" role="alert">
        {result.warnings.map((message) => <li key={message}>{message}</li>)}
      </ul>}
      {result && result.notes.length > 0 && <ul className="open-fem3d-load-panel-notes">
        {result.notes.map((message) => <li key={message}>{message}</li>)}
      </ul>}
    </Section>

    {error && <p className="open-fem3d-error" role="alert">{error}</p>}
    <Section title={t("openFem3d.loadPanel.actions")}>
      {loadCaseOptions.length > 1 && <div className="open-fem3d-load-panel-duplicate">
        <select className="fem-prop-input" aria-label={t("openFem3d.loadPanel.duplicate")}
          value={duplicateCaseId ?? ""} onChange={(event) => setDuplicateCaseId(event.target.value ? Number(event.target.value) : null)}>
          <option value="">{t("openFem3d.loadPanel.duplicate")}</option>
          {loadCaseOptions.filter((item) => item.id !== caseId).map((item) =>
            <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}
        </select>
        <button type="button" className="fem-prop-kiezer-btn" disabled={duplicateCaseId === null}
          onClick={() => {
            if (duplicateCaseId === null) return;
            try {
              onChange(duplicateOpenFem3DLoadPanel(model, panel.id, duplicateCaseId).model);
              setDuplicateCaseId(null);
              setError("");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}>{t("openFem3d.loadPanel.duplicateButton")}</button>
      </div>}
      <button className="open-fem3d-delete" type="button" onClick={() => onChange(removeOpenFem3DLoadPanel(model, panel.id))}>
        {t("openFem3d.loadPanel.delete")}
      </button>
    </Section>
  </div>;
}
