import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { solveNativeCrackWidth, type NativeCrackWidthResult } from "../../lib/nativeFemClient";
import {
  buildCrackWidthInput,
  CRACK_WIDTH_INPUT_FIELDS,
  INITIAL_CRACK_WIDTH_INPUT_TEXT,
  type CrackWidthInputText,
} from "../../lib/prestressedBeamCrackWidth";

export default function PrestressedBeamCrackWidthCheck() {
  const { t } = useTranslation("ribbon");
  const [values, setValues] = useState<CrackWidthInputText>(INITIAL_CRACK_WIDTH_INPUT_TEXT);
  const [result, setResult] = useState<NativeCrackWidthResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = buildCrackWidthInput(values);
      setResult(await solveNativeCrackWidth(input));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="prestressed-beam-card prestressed-beam-crack-width">
      <summary>{t("insights.prestressedBeam.crackWidthTitle")}</summary>
      <p className="prestressed-beam-help">{t("insights.prestressedBeam.crackWidthHelp")}</p>
      <form onSubmit={calculate}>
        <div className="prestressed-beam-grid">
          {CRACK_WIDTH_INPUT_FIELDS.map(({ key, labelKey, unit, optional }) => (
            <label className="prestressed-beam-field" key={key}>
              <span>{t(`insights.prestressedBeam.${labelKey}`)}{optional ? ` (${t("insights.prestressedBeam.optional")})` : ""}</span>
              <span className="prestressed-beam-input-wrap">
                <input type="number" step="any" value={values[key]}
                  onChange={(event) => {
                    setResult(null);
                    setError(null);
                    setValues((current) => ({ ...current, [key]: event.target.value }));
                  }} />
                <span>{unit}</span>
              </span>
            </label>
          ))}
        </div>
        <button type="submit" className="prestressed-beam-calculate" disabled={busy}>
          {busy ? t("insights.prestressedBeam.calculating") : t("insights.prestressedBeam.checkCrackWidth")}
        </button>
      </form>
      {error && <div className="prestressed-beam-error" role="alert">{error}</div>}
      {result && (
        <dl className="prestressed-beam-crack-result" aria-live="polite">
          <div><dt>{t("insights.prestressedBeam.crackWk")}</dt><dd>{result.crackWidthMm.toFixed(4)} mm</dd></div>
          <div><dt>{t("insights.prestressedBeam.crackWmax")}</dt><dd>{result.allowableCrackWidthMm.toFixed(3)} mm</dd></div>
          <div><dt>{t("insights.prestressedBeam.crackSpacingResult")}</dt>
            <dd>{result.maximumCrackSpacingMm.toFixed(1)} mm ({result.crackSpacingEquation})</dd></div>
          <div><dt>{t("insights.prestressedBeam.crackUtilization")}</dt><dd>{result.utilization.toFixed(3)}</dd></div>
          <div><dt>{t("insights.prestressedBeam.crackStatus")}</dt>
            <dd>{result.passes ? t("insights.prestressedBeam.crackPass") : t("insights.prestressedBeam.crackFail")}</dd></div>
        </dl>
      )}
    </details>
  );
}
