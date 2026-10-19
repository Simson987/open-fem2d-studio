import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Plate, PlateModulusPoint, PlateNonlinearLaw } from "./femTypes";

type Kind = "elastic" | "steelBilinear" | "concreteCracking" | "modulusCurve";

export default function PlateNonlinearEditor({ plate, baseEMpa, onApply }: {
  plate: Plate;
  baseEMpa: number | undefined;
  onApply: (patch: Pick<Plate, "nonlinearLaw" | "modulusCurve">) => void;
}) {
  const { t } = useTranslation("check");
  const initialKind = (): Kind => plate.modulusCurve?.length ? "modulusCurve"
    : plate.nonlinearLaw?.kind ?? "elastic";
  const [kind, setKind] = useState<Kind>(initialKind);
  const [strength, setStrength] = useState("");
  const [ratio, setRatio] = useState("");
  const [curve, setCurve] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setKind(initialKind());
    setStrength(plate.nonlinearLaw?.kind === "steelBilinear" ? String(plate.nonlinearLaw.yieldMpa)
      : plate.nonlinearLaw?.kind === "concreteCracking" ? String(plate.nonlinearLaw.tensileMpa) : "");
    setRatio(plate.nonlinearLaw?.kind === "steelBilinear" ? String(plate.nonlinearLaw.hardeningRatio)
      : plate.nonlinearLaw?.kind === "concreteCracking" ? String(plate.nonlinearLaw.residualRatio) : "");
    setCurve((plate.modulusCurve ?? []).map(point => `${point.strain} ${point.eMpa}`).join("\n"));
    setError(null);
  }, [plate.id, plate.nonlinearLaw, plate.modulusCurve]);

  const apply = () => {
    if (kind === "elastic") {
      onApply({ nonlinearLaw: undefined, modulusCurve: undefined });
      setError(null);
      return;
    }
    if (kind === "modulusCurve") {
      if (!Number.isFinite(baseEMpa) || !(baseEMpa! > 0)) {
        setError(t("props.plate.nonlinear.baseUnavailable"));
        return;
      }
      const lines = curve.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const points: PlateModulusPoint[] = [];
      let previousStrain = 0;
      let previousE = baseEMpa!;
      for (const line of lines) {
        const columns = line.split(/[\s;]+/);
        const strain = Number(columns[0]);
        const eMpa = Number(columns[1]);
        if (columns.length !== 2 || !Number.isFinite(strain) || strain <= previousStrain
          || !Number.isFinite(eMpa) || eMpa <= 0 || eMpa > previousE) {
          setError(t("props.plate.nonlinear.invalidCurveRow"));
          return;
        }
        points.push({ strain, eMpa });
        previousStrain = strain;
        previousE = eMpa;
      }
      if (points.length === 0) {
        setError(t("props.plate.nonlinear.needCurvePoint"));
        return;
      }
      onApply({ nonlinearLaw: undefined, modulusCurve: points });
      setError(null);
      return;
    }
    const strengthMpa = Number(strength);
    const stiffnessRatio = Number(ratio);
    if (!strength.trim() || !ratio.trim() || !Number.isFinite(strengthMpa) || strengthMpa <= 0
      || !Number.isFinite(stiffnessRatio) || stiffnessRatio < 0 || stiffnessRatio > 1) {
      setError(t("props.plate.nonlinear.invalidStrengthRatio"));
      return;
    }
    const law: PlateNonlinearLaw = kind === "steelBilinear"
      ? { kind, yieldMpa: strengthMpa, hardeningRatio: stiffnessRatio }
      : { kind, tensileMpa: strengthMpa, residualRatio: stiffnessRatio };
    onApply({ nonlinearLaw: law, modulusCurve: undefined });
    setError(null);
  };

  return <>
    <div className="fem-prop-row"><span className="fem-prop-label">{t("props.plate.nonlinear.model")}</span>
      <span className="fem-prop-value"><select className="fem-prop-input" value={kind}
        onChange={event => { setKind(event.target.value as Kind); setError(null); }}>
        <option value="elastic">{t("props.plate.nonlinear.elastic")}</option>
        <option value="steelBilinear">{t("props.plate.nonlinear.steelBilinear")}</option>
        <option value="concreteCracking">{t("props.plate.nonlinear.concreteCracking")}</option>
        <option value="modulusCurve">{t("props.plate.nonlinear.modulusCurve")}</option>
      </select></span></div>
    {(kind === "steelBilinear" || kind === "concreteCracking") && <>
      <div className="fem-prop-row"><span className="fem-prop-label">{kind === "steelBilinear" ? t("props.plate.nonlinear.yieldStrength") : t("props.plate.nonlinear.tensileStrength")}</span>
        <span className="fem-prop-value"><input className="fem-prop-input" type="number" min="0" step="any"
          value={strength} onChange={event => setStrength(event.target.value)} /> MPa</span></div>
      <div className="fem-prop-row"><span className="fem-prop-label">{kind === "steelBilinear" ? t("props.plate.nonlinear.hardening") : t("props.plate.nonlinear.residualStiffness")}</span>
        <span className="fem-prop-value"><input className="fem-prop-input" type="number" min="0" max="1" step="any"
          value={ratio} onChange={event => setRatio(event.target.value)} /> E/E₀</span></div>
    </>}
    {kind === "modulusCurve" && <>
      <p className="fem-prop-hint">{t("props.plate.nonlinear.curveHint", { e: baseEMpa?.toFixed(1) ?? "—" })}</p>
      <textarea className="fem-prop-input fem-prop-input-mono" rows={4} value={curve}
        onChange={event => setCurve(event.target.value)} placeholder={t("props.plate.nonlinear.curvePlaceholder")} />
    </>}
    <div className="fem-prop-kiezer-row"><button type="button" className="fem-prop-kiezer-btn" onClick={apply}>{t("props.plate.nonlinear.apply")}</button></div>
    {error && <p className="fem-prop-hint" role="alert">{error}</p>}
    <p className="fem-prop-hint">{t("props.plate.nonlinear.experimentalHint")}</p>
  </>;
}
