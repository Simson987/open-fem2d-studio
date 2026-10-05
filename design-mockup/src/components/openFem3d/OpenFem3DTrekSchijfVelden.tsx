import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OpenFem3DModel } from "./openFem3dModel";
import {
  addOpenFem3DDiaphragm,
  openFem3DDiaphragmOfNode,
  setOpenFem3DTensionOnly,
  type OpenFem3DDiaphragmRefusal,
} from "./openFem3dTrekSchijf";
import { toonMm } from "../../lib/lengthInput";

/**
 * "Alleen trek" voor één of meer staven. Bij een gemengde selectie staat het
 * vinkje half; aanvinken zet alle gekozen staven op trek-alleen.
 */
export function OpenFem3DTensionOnlyField({ model, beamIds, onChange }: {
  model: OpenFem3DModel;
  beamIds: readonly number[];
  onChange: (model: OpenFem3DModel) => void;
}) {
  const { t } = useTranslation("ribbon");
  const chosen = model.beams.filter((beam) => beamIds.includes(beam.id));
  const on = chosen.filter((beam) => beam.tensionOnly).length;
  const mixed = on > 0 && on < chosen.length;
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (box.current) box.current.indeterminate = mixed; }, [mixed]);
  // Een weigering (bijv. een staaf op bedding, #106) als melding, niet als fout.
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [beamIds.join(",")]);
  if (chosen.length === 0) return null;
  const zet = (aan: boolean) => {
    try {
      onChange(setOpenFem3DTensionOnly(model, chosen.map((beam) => beam.id), aan));
      setError(null);
    } catch (fout) {
      setError(fout instanceof Error ? fout.message : String(fout));
    }
  };
  return <section className="fem-prop-section">
    <div className="fem-prop-section-title">{t("openFem3d.trekSchijf.tensionOnlyTitle")}</div>
    <label className="open-fem3d-check-row">
      <input ref={box} type="checkbox" data-open-fem3d-tension-only
        checked={on === chosen.length}
        onChange={(event) => zet(event.target.checked)} />
      <span>{chosen.length === 1
        ? t("openFem3d.trekSchijf.tensionOnly")
        : t("openFem3d.trekSchijf.tensionOnlyMulti", { count: chosen.length })}</span>
    </label>
    <p className="fem-prop-hint">{t("openFem3d.trekSchijf.tensionOnlyHint")}</p>
    {error && <p className="open-fem3d-error" role="alert" data-open-fem3d-tension-only-error>{error}</p>}
  </section>;
}

function refusalText(t: (key: string, values?: Record<string, unknown>) => string, refusal: OpenFem3DDiaphragmRefusal) {
  switch (refusal.kind) {
    case "tooFewNodes": return t("openFem3d.trekSchijf.refused.tooFewNodes");
    case "missingNode": return t("openFem3d.trekSchijf.refused.missingNode", { node: refusal.nodeId });
    case "alreadyInDiaphragm": return t("openFem3d.trekSchijf.refused.alreadyInDiaphragm", { node: refusal.nodeId, id: refusal.diaphragmId });
    case "notLevel": return t("openFem3d.trekSchijf.refused.notLevel", {
      low: refusal.lowNodeId, high: refusal.highNodeId, mm: refusal.differenceMm.toFixed(1),
    });
  }
}

/** Een knop die van de geselecteerde knopen (zelfde hoogte) een starre schijf maakt. */
export function OpenFem3DDiaphragmFromSelection({ model, nodeIds, onChange }: {
  model: OpenFem3DModel;
  nodeIds: readonly number[];
  onChange: (model: OpenFem3DModel) => void;
}) {
  const { t } = useTranslation("ribbon");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [nodeIds.join(",")]);
  if (nodeIds.length < 2) return null;
  const make = () => {
    const made = addOpenFem3DDiaphragm(model, nodeIds);
    if (!made.ok) {
      setError(refusalText(t, made.refusal));
      return;
    }
    setError(null);
    onChange(made.model);
  };
  return <section className="fem-prop-section">
    <div className="fem-prop-section-title">{t("openFem3d.trekSchijf.diaphragmTitle")}</div>
    <div className="fem-prop-kiezer-row">
      <button type="button" className="fem-prop-kiezer-btn" data-open-fem3d-make-diaphragm onClick={make}>
        {t("openFem3d.trekSchijf.makeDiaphragm", { count: nodeIds.length })}
      </button>
    </div>
    <p className="fem-prop-hint">{t("openFem3d.trekSchijf.diaphragmHint")}</p>
    {error && <p className="open-fem3d-error" role="alert">{error}</p>}
  </section>;
}

/** Bij een knoop: de schijf waar hij bij hoort, met hoogte en aantal knopen. */
export function OpenFem3DNodeDiaphragmRow({ model, nodeId }: { model: OpenFem3DModel; nodeId: number }) {
  const { t } = useTranslation("ribbon");
  const diaphragm = openFem3DDiaphragmOfNode(model, nodeId);
  if (!diaphragm) return null;
  const z = model.nodes.find((node) => node.id === nodeId)?.z ?? 0;
  return <p className="fem-prop-hint" data-open-fem3d-node-diaphragm={diaphragm.id}>
    {t("openFem3d.trekSchijf.nodeInDiaphragm", {
      name: diaphragm.name ?? t("openFem3d.trekSchijf.diaphragmN", { id: diaphragm.id }),
      count: diaphragm.nodeIds.length, z: toonMm(z, "m"),
    })}
  </p>;
}
