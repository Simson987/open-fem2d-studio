import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Frame3DNonlinearLaw } from "./frame3dModel";

interface Props {
  law?: Frame3DNonlinearLaw;
  onApply: (law: Frame3DNonlinearLaw | undefined) => void;
  hint?: string;
  steelOnly?: boolean;
}

export default function Frame3DNonlinearLawEditor({ law, onApply, hint, steelOnly = false }: Props) {
  const { t } = useTranslation("check");
  const [kind, setKind] = useState<"elastic" | Frame3DNonlinearLaw["kind"]>(law?.kind ?? "elastic");
  const [strength, setStrength] = useState(law?.kind === "steelBilinear" ? String(law.yieldMpa)
    : law?.kind === "concreteCracking" ? String(law.tensileMpa) : "");
  const [ratio, setRatio] = useState(law?.kind === "steelBilinear" ? String(law.hardeningRatio)
    : law?.kind === "concreteCracking" ? String(law.residualRatio) : "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setKind(law?.kind ?? "elastic");
    setStrength(law?.kind === "steelBilinear" ? String(law.yieldMpa)
      : law?.kind === "concreteCracking" ? String(law.tensileMpa) : "");
    setRatio(law?.kind === "steelBilinear" ? String(law.hardeningRatio)
      : law?.kind === "concreteCracking" ? String(law.residualRatio) : "");
    setError(null);
  }, [law]);

  const apply = () => {
    if (steelOnly && kind === "concreteCracking") {
      setError("Dit gekoppelde element ondersteunt alleen staalplastificatie.");
      return;
    }
    if (kind === "elastic") {
      onApply(undefined);
      setError(null);
      return;
    }
    const strengthMpa = Number(strength);
    const stiffnessRatio = Number(ratio);
    if (!strength.trim() || !ratio.trim() || !Number.isFinite(strengthMpa) || strengthMpa <= 0
        || !Number.isFinite(stiffnessRatio) || stiffnessRatio < 0 || stiffnessRatio > 1
        || (steelOnly && stiffnessRatio === 1)) {
      setError(t("props.frame3dNonlinear.invalidStrengthRatio"));
      return;
    }
    onApply(kind === "steelBilinear"
      ? { kind, yieldMpa: strengthMpa, hardeningRatio: stiffnessRatio }
      : { kind, tensileMpa: strengthMpa, residualRatio: stiffnessRatio });
    setError(null);
  };

  return <>
    <div className="fem-prop-row"><span className="fem-prop-label">{t("props.frame3dNonlinear.title")}</span>
      <span className="fem-prop-value"><select className="fem-prop-input" value={kind}
        onChange={(event) => { setKind(event.target.value as typeof kind); setStrength(""); setRatio(""); setError(null); }}>
        <option value="elastic">{t("props.plate.nonlinear.elastic")}</option>
        <option value="steelBilinear">{t("props.plate.nonlinear.steelBilinear")}</option>
        {!steelOnly && <option value="concreteCracking">{t("props.frame3dNonlinear.concreteCracking")}</option>}
      </select></span></div>
    {kind !== "elastic" && <>
      <div className="fem-prop-row"><span className="fem-prop-label">{kind === "steelBilinear" ? t("props.plate.nonlinear.yieldStrength") : t("props.plate.nonlinear.tensileStrength")}</span>
        <span className="fem-prop-value"><input className="fem-prop-input" type="number" step="any" min="0"
          value={strength} onChange={(event) => setStrength(event.target.value)} /> MPa</span></div>
      <div className="fem-prop-row"><span className="fem-prop-label">{kind === "steelBilinear" ? t("props.plate.nonlinear.hardening") : t("props.plate.nonlinear.residualStiffness")}</span>
        <span className="fem-prop-value"><input className="fem-prop-input" type="number" step="any" min="0" max="1"
          value={ratio} onChange={(event) => setRatio(event.target.value)} /> E/E₀</span></div>
    </>}
    <div className="fem-prop-kiezer-row"><button type="button" className="fem-prop-kiezer-btn" onClick={apply}>{t("props.plate.nonlinear.apply")}</button></div>
    {error && <p className="fem-prop-hint" role="alert">{error}</p>}
    <p className="fem-prop-hint">{hint ?? t("props.frame3dNonlinear.experimentalHint")}</p>
  </>;
}
