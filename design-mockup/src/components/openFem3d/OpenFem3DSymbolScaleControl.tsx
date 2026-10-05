import { useTranslation } from "react-i18next";
import {
  OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT,
  OPEN_FEM_3D_SYMBOL_PERCENT_STOPS,
  normalizeOpenFem3DSymbolPercent,
  openFem3DSymbolPercentFromSlider,
  openFem3DSymbolSliderFromPercent,
} from "./openFem3dSymbolScale";
import "../fem/FemProjectTree.css";
import "./OpenFem3DEditor.css";

/** Welke regelaar: de knoopbollen of de opleggingssymbolen. */
export type OpenFem3DSymbolScaleTarget = "nodes" | "supports";

/**
 * De regelaar Grootte onder Knopen of Opleggingen (issue #82), in het venster
 * Zichtbaarheid en in de verkenner (tab Weergave): een subregel zoals de
 * regelaar Waarden onder de snedekrachtlijnen. In standen van 25 tot 400 %
 * (openFem3dSymbolScale.ts), 100 % precies in het midden; de waarde staat
 * erachter in %. Dubbelklik op de regelaar of een klik op de waarde zet hem
 * terug op 100 %.
 */
export default function OpenFem3DSymbolScaleControl({ target, percent, onChange, disabled = false, variant = "explorer" }: {
  target: OpenFem3DSymbolScaleTarget;
  percent: number;
  onChange: (percent: number) => void;
  /** De laag staat uit: de regelaar gedimd (de waarde blijft bewaard). */
  disabled?: boolean;
  /** Verkenner (subregel onder de schakelaar) of venster Zichtbaarheid. */
  variant?: "explorer" | "dialog";
}) {
  const { t } = useTranslation("common");
  const value = normalizeOpenFem3DSymbolPercent(percent);
  const text = t("openFem3dSymbolScale.value", { n: value });
  const terug = () => { if (value !== OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT) onChange(OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT); };
  return <div className={`fem-results-scale-row open-fem3d-symbol-scale open-fem3d-symbol-scale-${variant}${disabled ? " uit" : ""}`}
    title={t("openFem3dSymbolScale.hint")} data-open-fem3d-symbol-scale={target} data-percent={value}>
    <span className="fem-results-scale-end open-fem3d-symbol-scale-label" aria-hidden="true">{t("openFem3dSymbolScale.size")}</span>
    <input type="range" className="fem-results-scale-slider" aria-label={t(`openFem3dSymbolScale.${target}Aria`)}
      min={0} max={OPEN_FEM_3D_SYMBOL_PERCENT_STOPS.length - 1} step={1}
      value={openFem3DSymbolSliderFromPercent(value)} disabled={disabled} aria-valuetext={text}
      onChange={(event) => onChange(openFem3DSymbolPercentFromSlider(Number(event.target.value)))}
      onDoubleClick={() => onChange(OPEN_FEM_3D_SYMBOL_PERCENT_DEFAULT)} />
    <button type="button" className="fem-results-scale-value open-fem3d-symbol-scale-value" onClick={terug}
      title={t("openFem3dSymbolScale.reset")} aria-label={`${text} · ${t("openFem3dSymbolScale.reset")}`}>{text}</button>
  </div>;
}
