import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OpenFem3DModel, OpenFem3DVector } from "./openFem3dModel";
import {
  openFem3DEnvelopePanelGeometry, openFem3DEnvelopePanelSupportWarnings,
  removeOpenFem3DEnvelopePanel, updateOpenFem3DEnvelopePanel,
} from "./openFem3dEnvelopePanels";

const AXES: Record<"x" | "y" | "z", OpenFem3DVector> = {
  x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fem-prop-row"><span className="fem-prop-label">{label}</span><span className="fem-prop-value">{children}</span></div>;
}

export default function OpenFem3DEnvelopePanelProperties({ model, panelId, onChange }: {
  model: OpenFem3DModel; panelId: number; onChange: (model: OpenFem3DModel) => void;
}) {
  const { t } = useTranslation("common");
  const panel = (model.envelopePanels ?? []).find((candidate) => candidate.id === panelId)!;
  const [openingText, setOpeningText] = useState("");
  const [error, setError] = useState("");
  const apply = (patch: Parameters<typeof updateOpenFem3DEnvelopePanel>[2]) => {
    try {
      onChange(updateOpenFem3DEnvelopePanel(model, panelId, patch));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  let area = "—";
  try { area = openFem3DEnvelopePanelGeometry(model, panel).netAreaM2.toLocaleString(undefined, { maximumFractionDigits: 3 }); }
  catch (cause) { area = cause instanceof Error ? cause.message : String(cause); }
  const span = panel.spanDirection;
  const axis = span && (Object.keys(AXES) as (keyof typeof AXES)[]).find((key) => {
    const value = AXES[key];
    return span.x === value.x && span.y === value.y && span.z === value.z;
  });
  return <>
    <section className="fem-prop-section">
      <div className="fem-prop-section-title">{t("envelopePanel.geometry")}</div>
      <Row label={t("envelopePanel.name")}>
        <input className="fem-prop-input" type="text" value={panel.name ?? ""}
          onChange={(event) => apply({ name: event.target.value })} />
      </Row>
      <Row label={t("envelopePanel.type")}>
        <select className="fem-prop-input" value={panel.type}
          onChange={(event) => apply({ type: event.target.value as "facade" | "roof" })}>
          <option value="facade">{t("tree.envelopeFacade")}</option>
          <option value="roof">{t("tree.envelopeRoof")}</option>
        </select>
      </Row>
      <Row label={t("envelopePanel.area")}>{area} m²</Row>
      <Row label={t("envelopePanel.outerSide")}>
        <button type="button" onClick={() => apply({ flipOuterSide: !panel.flipOuterSide })}>
          {t("envelopePanel.flip")}
        </button>
      </Row>
    </section>
    <section className="fem-prop-section">
      <div className="fem-prop-section-title">{t("envelopePanel.transfer")}</div>
      <Row label={t("envelopePanel.distribution")}>
        <select className="fem-prop-input" value={panel.distribution}
          onChange={(event) => apply({ distribution: event.target.value as "oneWay" | "twoWay" })}>
          <option value="oneWay">{t("tree.loadPanelOneWay")}</option>
          <option value="twoWay">{t("tree.loadPanelTwoWay")}</option>
        </select>
      </Row>
      {panel.distribution === "oneWay" && <Row label={t("envelopePanel.span")}>
        <select className="fem-prop-input" value={axis ?? "custom"}
          onChange={(event) => { if (event.target.value in AXES) apply({ spanDirection: AXES[event.target.value as keyof typeof AXES] }); }}>
          <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
          {!axis && <option value="custom">{t("envelopePanel.customSpan")}</option>}
        </select>
      </Row>}
      {panel.distribution === "oneWay" && <Row label="X / Y / Z">
        {(["x", "y", "z"] as const).map((component) =>
          <input key={component} className="fem-prop-input" type="number" step="0.1"
            aria-label={`${t("envelopePanel.span")} ${component.toUpperCase()}`}
            style={{ width: 55 }} value={span?.[component] ?? 0}
            onChange={(event) => apply({ spanDirection: { x: span?.x ?? 0, y: span?.y ?? 0, z: span?.z ?? 0,
              [component]: Number(event.target.value) } })} />)}
      </Row>}
      <Row label={t("envelopePanel.weight")}>
        <input className="fem-prop-input" type="number" min="0" step="0.01"
          value={panel.claddingWeightKnPerM2 ?? ""}
          onChange={(event) => apply({ claddingWeightKnPerM2: event.target.value === "" ? undefined : Number(event.target.value) })} />
        <span> kN/m²</span>
      </Row>
    </section>
    <section className="fem-prop-section">
      <div className="fem-prop-section-title">{t("envelopePanel.openings")}</div>
      {(panel.openings ?? []).map((opening) => <Row key={opening.id} label={`#${opening.id}`}>
        {opening.nodeIds.join("–")}
        <button type="button" onClick={() => apply({ openings: panel.openings!.filter((item) => item.id !== opening.id) })}>
          {t("envelopePanel.removeOpening")}
        </button>
      </Row>)}
      <Row label={t("envelopePanel.addOpening")}>
        <input className="fem-prop-input" type="text" value={openingText}
          placeholder={t("envelopePanel.openingNodes")}
          onChange={(event) => setOpeningText(event.target.value)} />
        <button type="button" onClick={() => {
          const nodeIds = openingText.split(/[\s,;]+/).filter(Boolean).map(Number);
          if (nodeIds.length < 3 || nodeIds.some((id) => !Number.isSafeInteger(id))) {
            setError(t("envelopePanel.invalidOpening")); return;
          }
          const id = (panel.openings ?? []).reduce((max, opening) => Math.max(max, opening.id), 0) + 1;
          apply({ openings: [...(panel.openings ?? []), { id, nodeIds }] });
          setOpeningText("");
        }}>{t("envelopePanel.add")}</button>
      </Row>
    </section>
    {openFem3DEnvelopePanelSupportWarnings(model, panel).map((warning, index) =>
      <p key={index} role="alert" className="fem-prop-hint">{warning}</p>)}
    {error && <p role="alert" className="fem-prop-hint">{error}</p>}
    <button className="open-fem3d-delete" type="button" onClick={() => onChange(removeOpenFem3DEnvelopePanel(model, panelId))}>
      {t("envelopePanel.delete")}
    </button>
  </>;
}
