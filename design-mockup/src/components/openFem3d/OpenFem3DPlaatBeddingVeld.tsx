import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { setOpenFem3DPlateBedding, type OpenFem3DModel, type OpenFem3DPlateBedding } from "./openFem3dModel";
import {
  OPEN_FEM_3D_PLATE_BEDDING_DEFAULT_K_KN_PER_M3, openFem3DPlateBeddingSummary, openFem3DPlateGroundSide,
} from "./openFem3dPlateBedding";
import { GetalVeld } from "./OpenFem3DBeddingVeld";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";

/**
 * "Op bedding" (issue #107) voor één plaat of een selectie van platen: k
 * (kN/m³) en "alleen druk". Aanvinken zet direct k = 50 000 kN/m³, zoals de
 * staafbedding; uitvinken haalt de bedding weg. Elke wijziging is één stap
 * ongedaan maken (dezelfde zuivere functie als de API). Rekent niets: de kern
 * zet de grondveren op de knopen van het rekennet.
 *
 * Een wand op bedding: de grondzijde volgt uit de plaatassen en is niet te
 * kiezen (een wand in het XZ-vlak heeft de grond aan +Y, in het YZ-vlak aan
 * −X). Het paneel noemt die zijde, en waarschuwt bij alleen druk: ligt de
 * grond aan de andere kant, dan werkt de grond aan de verkeerde kant.
 */
export function OpenFem3DPlateBeddingField({ model, plateIds, onChange }: {
  model: OpenFem3DModel;
  plateIds: readonly number[];
  onChange: (model: OpenFem3DModel) => void;
}) {
  const { t } = useTranslation("ribbon");
  const chosen = (model.plates ?? []).filter((plate) => plateIds.includes(plate.id));
  const withBedding = chosen.filter((plate) => plate.bedding);
  const allOn = chosen.length > 0 && withBedding.length === chosen.length;
  const someOn = withBedding.length > 0 && !allOn;
  const current = withBedding[0]?.bedding;
  const different = withBedding.some((plate) => JSON.stringify(plate.bedding) !== JSON.stringify(current));
  const [error, setError] = useState<string | null>(null);
  const selectie = chosen.map((plate) => plate.id).join(",");
  useEffect(() => { setError(null); }, [selectie]);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (box.current) box.current.indeterminate = someOn; }, [someOn]);
  if (chosen.length === 0) return null;

  const ids = chosen.map((plate) => plate.id);
  const zet = (bedding: OpenFem3DPlateBedding | null) => {
    try {
      const next = setOpenFem3DPlateBedding(model, ids, bedding);
      setError(null);
      if (next !== model) onChange(next);
    } catch (fout) {
      setError(fout instanceof Error ? fout.message : String(fout));
    }
  };
  const shown = allOn ? current : undefined;
  // Wanden op bedding met hun grondzijde (zie de uitleg hierboven).
  const wanden = withBedding.flatMap((plate) => {
    const zijde = openFem3DPlateGroundSide(model, plate);
    return zijde?.vertical ? [{ id: plate.id, side: zijde.side, compressionOnly: plate.bedding?.compressionOnly === true }] : [];
  });
  const zijden = [...new Set(wanden.map((wand) => wand.side))];
  const zijde = zijden.length === 1 ? zijden[0] : wanden.map((wand) => `${wand.side} (${wand.id})`).join(", ");

  return <section className="fem-prop-section" data-open-fem3d-plate-bedding-section>
    <div className="fem-prop-section-title">{t("openFem3d.plateBedding.title")}</div>
    <label className="open-fem3d-check-row">
      <input ref={box} type="checkbox" data-open-fem3d-plate-bedding checked={allOn}
        onChange={(event) => zet(event.target.checked
          ? current ?? { kKnPerM3: OPEN_FEM_3D_PLATE_BEDDING_DEFAULT_K_KN_PER_M3 }
          : null)} />
      <span>{chosen.length === 1 ? t("openFem3d.plateBedding.toggle") : t("openFem3d.plateBedding.toggleMulti", { count: chosen.length })}</span>
    </label>
    {shown && <>
      <div className="fem-prop-row" title={t("openFem3d.plateBedding.modulusTitle")}>
        <span className="fem-prop-label">{t("openFem3d.plateBedding.modulus")}</span>
        <span className="fem-prop-value"><GetalVeld data-open-fem3d-plate-bedding-k value={shown.kKnPerM3}
          aria-label={t("openFem3d.plateBedding.modulusTitle")}
          onCommit={(k) => { if (k !== undefined) zet({ ...shown, kKnPerM3: k }); }} /></span>
      </div>
      <label className="open-fem3d-check-row">
        <input type="checkbox" data-open-fem3d-plate-bedding-compression checked={shown.compressionOnly === true}
          onChange={(event) => zet({ kKnPerM3: shown.kKnPerM3, ...(event.target.checked ? { compressionOnly: true } : {}) })} />
        <span>{t("openFem3d.plateBedding.compressionOnly")}</span>
      </label>
      {different && <p className="fem-prop-hint">{t("openFem3d.plateBedding.mixed")}</p>}
    </>}
    {wanden.length > 0 && <p className="fem-prop-hint" data-open-fem3d-plate-bedding-wall={zijde}>
      {t("openFem3d.plateBedding.wallSide", { side: zijde })}</p>}
    {wanden.some((wand) => wand.compressionOnly) && <p className="open-fem3d-error" data-open-fem3d-plate-bedding-wall-compression>
      {t("openFem3d.plateBedding.wallCompression", { side: zijde })}</p>}
    {error && <p className="open-fem3d-error" role="alert" data-open-fem3d-plate-bedding-error>{error}</p>}
    <p className="fem-prop-hint">{t("openFem3d.plateBedding.hint")}</p>
    {shown && <p className="fem-prop-hint">{t("openFem3d.plateBedding.compressionHint")}</p>}
  </section>;
}

/** De uitkomst van de bedding bij één plaat (tab Resultaten); niets zonder bedding. */
export function OpenFem3DPlateBeddingResults({ model, plateId, result }: {
  model: OpenFem3DModel;
  plateId: number;
  result: OpenFem3DSolveResult;
}) {
  const { t } = useTranslation("ribbon");
  const row = openFem3DPlateBeddingSummary({ plates: (model.plates ?? []).filter((plate) => plate.id === plateId) }, result)[0];
  if (!row) return null;
  const getal = (waarde: number, cijfers = 2) => Number.isFinite(waarde) ? waarde.toFixed(cijfers) : "—";
  return <section className="fem-prop-section" data-open-fem3d-plate-bedding-results={plateId}>
    <div className="fem-prop-section-title">{t("openFem3d.plateBedding.resultsTitle")}</div>
    {!row.result ? <p className="fem-prop-hint">{t("openFem3d.plateBedding.noResult")}</p> : <>
      <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.plateBedding.maxSettlement")}</span>
        <span className="fem-prop-value"><code>{getal(row.result.maxSettlementMm, 3)} mm</code></span></div>
      <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.plateBedding.maxPressure")}</span>
        <span className="fem-prop-value"><code>{getal(row.result.maxPressureKnPerM2)} kN/m²</code></span></div>
      <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.plateBedding.minPressure")}</span>
        <span className="fem-prop-value"><code>{getal(row.result.minPressureKnPerM2)} kN/m²</code></span></div>
      {row.compressionOnly && <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.plateBedding.lifted")}</span>
        <span className="fem-prop-value"><code>{getal(row.result.liftedPercent, 1)} %</code></span></div>}
      <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.plateBedding.totalReaction")}</span>
        <span className="fem-prop-value"><code>{getal(row.result.totalReactionKn)} kN</code></span></div>
    </>}
  </section>;
}
