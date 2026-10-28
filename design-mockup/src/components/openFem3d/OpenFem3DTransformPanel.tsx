import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { parseLength } from "../../lib/lengthInput";
import type { OpenFem3DTool } from "./openFem3dCommands";
import type { OpenFem3DAxis, OpenFem3DTransformCommand } from "./openFem3dTransform";
import { openFem3DBeddingRefusal } from "./openFem3dBedding";

type OpenFem3DTransformTool = Extract<OpenFem3DTool, "move" | "rotate" | "copy" | "mirror">;

interface Props {
  tool: OpenFem3DTransformTool;
  selectionLabel: string;
  pointHelp?: string;
  onApply: (command: OpenFem3DTransformCommand) => void;
  onCancel: () => void;
}

/** De ingetypte tekst van het paneel: lengtes in mm, de hoek in graden. */
export interface OpenFem3DTransformFields {
  dx: string;
  dy: string;
  dz: string;
  axis: OpenFem3DAxis;
  angle: string;
  offset: string;
}

const TITLE_KEYS: Record<OpenFem3DTransformTool, string> = {
  move: "openFem3d.transform.move",
  rotate: "openFem3d.transform.rotate",
  copy: "openFem3d.transform.copy",
  mirror: "openFem3d.transform.mirror",
};

function getal(value: string, naam: string, t: TFunction): number {
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(t("openFem3d.transform.invalidNumber", { name: naam }));
  return n;
}

/** Lengte in mm (komma of punt) naar meters: het 3D-model rekent in meters. */
function lengte(value: string, naam: string, t: TFunction): number {
  const meters = parseLength(value, "m");
  if (!Number.isFinite(meters)) throw new Error(t("openFem3d.transform.invalidNumber", { name: naam }));
  return meters;
}

/**
 * De bewerking die "Toepassen" uitvoert. ΔX/ΔY/ΔZ en het spiegelvlak worden in
 * mm ingetypt (issue #36) en gaan in meters naar het model; ongeldige tekst
 * gooit met de melding voor het paneel, zodat er niets verandert.
 */
export function openFem3DTransformCommand(
  tool: OpenFem3DTransformTool, fields: OpenFem3DTransformFields, t: TFunction,
): OpenFem3DTransformCommand {
  return tool === "move" || tool === "copy"
    ? { kind: tool, dx: lengte(fields.dx, "ΔX", t), dy: lengte(fields.dy, "ΔY", t), dz: lengte(fields.dz, "ΔZ", t) }
    : tool === "rotate"
      ? { kind: "rotate", axis: fields.axis, angleDeg: getal(fields.angle, t("openFem3d.transform.angle"), t) }
      : { kind: "mirror", axis: fields.axis, offset: lengte(fields.offset, t("openFem3d.transform.planeCoordinate"), t) };
}

export default function OpenFem3DTransformPanel({ tool, selectionLabel, pointHelp, onApply, onCancel }: Props) {
  const { t } = useTranslation("ribbon");
  const title = t(TITLE_KEYS[tool]);
  const [dx, setDx] = useState("0");
  const [dy, setDy] = useState("0");
  const [dz, setDz] = useState("0");
  const [axis, setAxis] = useState<OpenFem3DAxis>("z");
  const [angle, setAngle] = useState("90");
  const [offset, setOffset] = useState("0");
  const [error, setError] = useState("");
  useEffect(() => { setError(""); }, [tool, selectionLabel]);

  const apply = () => {
    try {
      onApply(openFem3DTransformCommand(tool, { dx, dy, dz, axis, angle, offset }, t));
    } catch (reason) {
      // Een staaf op een verticale bedding die verticaal zou komen (#106): vertaald.
      const bedding = openFem3DBeddingRefusal(reason);
      setError(bedding ? t(bedding.key, bedding.values) : reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <aside className="open-fem3d-transform-panel" aria-label={title}>
    <div className="open-fem3d-transform-title"><strong>{title}</strong><button type="button" onClick={onCancel}>×</button></div>
    <p>{selectionLabel}</p>
    {pointHelp && <p role="status">{pointHelp}</p>}
    {(tool === "move" || tool === "copy") ? <div className="open-fem3d-transform-grid">
      <label>ΔX (mm)<input value={dx} onChange={(event) => setDx(event.target.value)} inputMode="decimal" /></label>
      <label>ΔY (mm)<input value={dy} onChange={(event) => setDy(event.target.value)} inputMode="decimal" /></label>
      <label>ΔZ (mm)<input value={dz} onChange={(event) => setDz(event.target.value)} inputMode="decimal" /></label>
    </div> : <>
      <label className="open-fem3d-transform-field">{t("openFem3d.transform.globalAxis")}<select value={axis} onChange={(event) => setAxis(event.target.value as OpenFem3DAxis)}>
        <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
      </select></label>
      {tool === "rotate"
        ? <label className="open-fem3d-transform-field">{t("openFem3d.transform.angleDeg")}<input value={angle} onChange={(event) => setAngle(event.target.value)} inputMode="decimal" /></label>
        : <label className="open-fem3d-transform-field">{t("openFem3d.transform.mirrorPlane")}<input value={offset} onChange={(event) => setOffset(event.target.value)} inputMode="decimal" /></label>}
    </>}
    {error && <p className="open-fem3d-transform-error">{error}</p>}
    <div className="open-fem3d-transform-actions">
      <button type="button" onClick={onCancel}>{t("cancel", { ns: "common" })}</button>
      <button type="button" className="primary" onClick={apply}>{t("openFem3d.apply")}</button>
    </div>
  </aside>;
}
