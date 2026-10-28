import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  removeOpenFem3DOpeningLintel, setOpenFem3DOpeningLintel, setOpenFem3DPlateMasonry,
  type OpenFem3DModel, type OpenFem3DPlate,
} from "./openFem3dModel";
import {
  OPEN_FEM_3D_LINTEL_DEFAULT_BEARING_M, OPEN_FEM_3D_MASONRY_DEFAULT_E_MPA, OPEN_FEM_3D_MASONRY_DEFAULT_UNIT_WEIGHT,
  openFem3DLintelDesign, type OpenFem3DLintelLoadSpread,
} from "./openFem3dMetselwerkwand";
import { GetalVeld } from "./OpenFem3DBeddingVeld";

/**
 * "Metselwerkwand" (issue #97) in het eigenschappenpaneel van een plaat:
 * aanvinken maakt van een verticale plaat een metselwerkwand (γ, E). Per
 * opening staat er dan een latei met opleglengte en lastspreiding. Elke
 * wijziging is één stap ongedaan maken: dezelfde zuivere functies als de API
 * (model3d.plate.setMasonry / setLintel). Doorsnede en materiaal van de latei
 * wijzig je bij de lateistaaf zelf.
 */
export function OpenFem3DMasonryWallField({ model, plate, onChange }: {
  model: OpenFem3DModel;
  plate: OpenFem3DPlate;
  onChange: (model: OpenFem3DModel) => void;
}) {
  const { t } = useTranslation("ribbon");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [plate.id]);
  const probeer = (wijzig: () => OpenFem3DModel) => {
    try {
      const next = wijzig();
      setError(null);
      if (next !== model) onChange(next);
    } catch (fout) {
      setError(fout instanceof Error ? fout.message : String(fout));
    }
  };
  const wand = plate.masonry;
  const spreidingen: OpenFem3DLintelLoadSpread[] = ["triangle60", "fullHeight"];

  return <section className="fem-prop-section" data-open-fem3d-masonry-section>
    <div className="fem-prop-section-title">{t("openFem3d.masonry.title")}</div>
    <label className="open-fem3d-check-row">
      <input type="checkbox" data-open-fem3d-masonry checked={!!wand}
        onChange={(event) => probeer(() => setOpenFem3DPlateMasonry(model, plate.id, event.target.checked
          ? { unitWeightKnM3: OPEN_FEM_3D_MASONRY_DEFAULT_UNIT_WEIGHT, eMpa: OPEN_FEM_3D_MASONRY_DEFAULT_E_MPA }
          : null))} />
      <span>{t("openFem3d.masonry.toggle")}</span>
    </label>
    {wand && <>
      <div className="fem-prop-row" title={t("openFem3d.masonry.unitWeightTitle")}>
        <span className="fem-prop-label">{t("openFem3d.masonry.unitWeight")}</span>
        <span className="fem-prop-value"><GetalVeld data-open-fem3d-masonry-unit-weight value={wand.unitWeightKnM3}
          aria-label={t("openFem3d.masonry.unitWeightTitle")}
          onCommit={(gamma) => { if (gamma !== undefined) probeer(() => setOpenFem3DPlateMasonry(model, plate.id, { ...wand, unitWeightKnM3: gamma })); }} /></span>
      </div>
      <div className="fem-prop-row" title={t("openFem3d.masonry.modulusTitle")}>
        <span className="fem-prop-label">{t("openFem3d.masonry.modulus")}</span>
        <span className="fem-prop-value"><GetalVeld data-open-fem3d-masonry-e value={wand.eMpa}
          aria-label={t("openFem3d.masonry.modulusTitle")}
          onCommit={(e) => { if (e !== undefined) probeer(() => setOpenFem3DPlateMasonry(model, plate.id, { ...wand, eMpa: e })); }} /></span>
      </div>
      <p className="fem-prop-hint">{t("openFem3d.masonry.hint")}</p>
      {(plate.openings ?? []).map((opening) => {
        const latei = opening.lintel;
        let ontwerp: ReturnType<typeof openFem3DLintelDesign> = null;
        try { ontwerp = openFem3DLintelDesign(model, plate, opening); } catch { ontwerp = null; }
        return <div key={opening.id} data-open-fem3d-lintel={`${plate.id}:${opening.id}`}>
          <label className="open-fem3d-check-row">
            <input type="checkbox" checked={!!latei} data-open-fem3d-lintel-toggle={opening.id}
              onChange={(event) => probeer(() => event.target.checked
                ? setOpenFem3DOpeningLintel(model, plate.id, opening.id, { bearingM: OPEN_FEM_3D_LINTEL_DEFAULT_BEARING_M, loadSpread: "triangle60" })
                : removeOpenFem3DOpeningLintel(model, plate.id, opening.id))} />
            <span>{t("openFem3d.masonry.lintel", { opening: opening.id })}</span>
          </label>
          {latei && <>
            <div className="fem-prop-row">
              <span className="fem-prop-label">{t("openFem3d.masonry.lintelBeam")}</span>
              <span className="fem-prop-value"><code>S{latei.beamId}</code></span>
            </div>
            <div className="fem-prop-row">
              <span className="fem-prop-label">{t("openFem3d.masonry.bearing")}</span>
              <span className="fem-prop-value"><GetalVeld data-open-fem3d-lintel-bearing value={Math.round(latei.bearingM * 1000)}
                aria-label={t("openFem3d.masonry.bearing")}
                onCommit={(mm) => { if (mm !== undefined) probeer(() => setOpenFem3DOpeningLintel(model, plate.id, opening.id, { bearingM: mm / 1000, loadSpread: latei.loadSpread })); }} /></span>
            </div>
            <div className="fem-prop-row">
              <span className="fem-prop-label">{t("openFem3d.masonry.loadSpread")}</span>
              <span className="fem-prop-value"><select className="fem-prop-input" value={latei.loadSpread} data-open-fem3d-lintel-spread
                onChange={(event) => probeer(() => setOpenFem3DOpeningLintel(model, plate.id, opening.id, {
                  bearingM: latei.bearingM, loadSpread: event.target.value as OpenFem3DLintelLoadSpread,
                }))}>
                {spreidingen.map((spreiding) => <option key={spreiding} value={spreiding}>{t(`openFem3d.masonry.spread.${spreiding}`)}</option>)}
              </select></span>
            </div>
            {ontwerp && <p className="fem-prop-hint" data-open-fem3d-lintel-design>
              {t("openFem3d.masonry.design", {
                span: ontwerp.spanM.toFixed(2), load: ontwerp.loadKn.toFixed(2), moment: ontwerp.momentKnm.toFixed(2),
                support: ontwerp.supportKn.toFixed(2), spread: t(`openFem3d.masonry.spread.${ontwerp.applied}`),
              })}
              {ontwerp.note ? ` ${t("openFem3d.masonry.fallback", { above: ontwerp.heightAboveM.toFixed(2), triangle: ontwerp.triangleHeightM.toFixed(2) })}` : ""}
            </p>}
          </>}
        </div>;
      })}
      {(plate.openings ?? []).length > 0 && <p className="fem-prop-hint">{t("openFem3d.masonry.lintelHint")}</p>}
    </>}
    {error && <p className="open-fem3d-error" role="alert" data-open-fem3d-masonry-error>{error}</p>}
  </section>;
}
