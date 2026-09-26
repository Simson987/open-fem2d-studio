import { useEffect, useState } from "react";
import type { Frame3DTool } from "./frame3dCommands";
import type { Frame3DAxis, Frame3DTransformCommand } from "./frame3dTransform";

interface Props {
  tool: Extract<Frame3DTool, "move" | "rotate" | "copy" | "mirror">;
  selectionLabel: string;
  onApply: (command: Frame3DTransformCommand) => void;
  onCancel: () => void;
}

const title: Record<Props["tool"], string> = {
  move: "3D verplaatsen",
  rotate: "3D roteren",
  copy: "3D kopiëren",
  mirror: "3D spiegelen",
};

function getal(value: string, naam: string): number {
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`${naam} is geen geldig getal.`);
  return n;
}

export default function Frame3DTransformPanel({ tool, selectionLabel, onApply, onCancel }: Props) {
  const [dx, setDx] = useState("0");
  const [dy, setDy] = useState("0");
  const [dz, setDz] = useState("0");
  const [axis, setAxis] = useState<Frame3DAxis>("z");
  const [angle, setAngle] = useState("90");
  const [offset, setOffset] = useState("0");
  const [error, setError] = useState("");
  useEffect(() => { setError(""); }, [tool, selectionLabel]);

  const apply = () => {
    try {
      const command: Frame3DTransformCommand = tool === "move" || tool === "copy"
        ? { kind: tool, dx: getal(dx, "ΔX"), dy: getal(dy, "ΔY"), dz: getal(dz, "ΔZ") }
        : tool === "rotate"
          ? { kind: "rotate", axis, angleDeg: getal(angle, "Hoek") }
          : { kind: "mirror", axis, offset: getal(offset, "Vlakcoördinaat") };
      onApply(command);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <aside className="frame3d-transform-panel" aria-label={title[tool]}>
    <div className="frame3d-transform-title"><strong>{title[tool]}</strong><button type="button" onClick={onCancel}>×</button></div>
    <p>{selectionLabel}</p>
    {(tool === "move" || tool === "copy") ? <div className="frame3d-transform-grid">
      <label>ΔX (m)<input value={dx} onChange={(event) => setDx(event.target.value)} inputMode="decimal" /></label>
      <label>ΔY (m)<input value={dy} onChange={(event) => setDy(event.target.value)} inputMode="decimal" /></label>
      <label>ΔZ (m)<input value={dz} onChange={(event) => setDz(event.target.value)} inputMode="decimal" /></label>
    </div> : <>
      <label className="frame3d-transform-field">Globale as<select value={axis} onChange={(event) => setAxis(event.target.value as Frame3DAxis)}>
        <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
      </select></label>
      {tool === "rotate"
        ? <label className="frame3d-transform-field">Hoek (°)<input value={angle} onChange={(event) => setAngle(event.target.value)} inputMode="decimal" /></label>
        : <label className="frame3d-transform-field">Spiegelvlak op (m)<input value={offset} onChange={(event) => setOffset(event.target.value)} inputMode="decimal" /></label>}
    </>}
    {error && <p className="frame3d-transform-error">{error}</p>}
    <div className="frame3d-transform-actions">
      <button type="button" onClick={onCancel}>Annuleren</button>
      <button type="button" className="primary" onClick={apply}>Toepassen</button>
    </div>
  </aside>;
}
