import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CONCRETE_E_CM, NU_BETON } from "../../lib/sectionResolver";
import { resolveOpenFem3DAnalysisMaterial, setOpenFem3DAnalysisMaterial,
  type OpenFem3DAnalysisMaterial, type OpenFem3DConcreteModulus } from "./openFem3dAnalysisMaterial";
import type { OpenFem3DModel } from "./openFem3dModel";

/** Eén materiaalinstelling voor alle 3D-staven en -platen van die betonklasse. */
export default function OpenFem3DAnalysisMaterialField({ model, material, onChange }: {
  model: OpenFem3DModel; material: string; onChange: (model: OpenFem3DModel) => void;
}) {
  const { t } = useTranslation("ribbon");
  const [error, setError] = useState("");
  if (!Object.prototype.hasOwnProperty.call(CONCRETE_E_CM, material)) return null;
  const current = model.analysisMaterials?.[material] ?? {};
  const baseE = CONCRETE_E_CM[material];
  const effective = resolveOpenFem3DAnalysisMaterial(material, baseE, NU_BETON, model);
  const choice = current.concreteModulus;
  const mode = choice?.kind ?? "ecm";
  const set = (modulus: OpenFem3DConcreteModulus | undefined, nu = current.nu) => {
    const next: OpenFem3DAnalysisMaterial = {
      ...(modulus && modulus.kind !== "ecm" ? { concreteModulus: modulus } : {}),
      ...(nu !== undefined ? { nu } : {}),
    };
    onChange(setOpenFem3DAnalysisMaterial(model, material, Object.keys(next).length ? next : null));
    setError("");
  };
  const numberOnBlur = (raw: string, kind: "phi" | "eMpa" | "nu") => {
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value)
      || (kind === "phi" && value < 0)
      || (kind === "eMpa" && value <= 0)
      || (kind === "nu" && (value < 0 || value >= 0.5))) {
      setError(t("openFem3d.props.analysisInvalid"));
      return;
    }
    if (kind === "nu") {
      if (value !== (current.nu ?? NU_BETON)) set(choice, value);
    } else if (kind === "phi") {
      if (choice?.kind !== "creep" || value !== choice.phi) set({ kind: "creep", phi: value });
    } else if (choice?.kind !== "custom" || value !== choice.eMpa) set({ kind: "custom", eMpa: value });
  };
  return <div className="open-fem3d-analysis-material" data-open-fem3d-analysis-material={material}>
    <p className="fem-prop-hint">{t("openFem3d.props.analysisMaterialHint", { material })}</p>
    <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.props.analysisEChoice")}</span>
      <select className="fem-prop-input" value={mode} data-open-fem3d-analysis-mode
        onChange={(event) => set(event.target.value === "creep" ? { kind: "creep", phi: 2 }
          : event.target.value === "custom" ? { kind: "custom", eMpa: baseE } : undefined)}>
        <option value="ecm">Ecm</option>
        <option value="creep">{t("openFem3d.props.analysisCreep")}</option>
        <option value="custom">{t("openFem3d.props.analysisCustom")}</option>
      </select></div>
    {mode === "creep" && <div className="fem-prop-row"><span className="fem-prop-label">φ</span>
      <input key={`${material}-phi-${choice?.kind === "creep" ? choice.phi : 2}`} className="fem-prop-input"
        type="number" min="0" step="any" defaultValue={choice?.kind === "creep" ? choice.phi : 2}
        data-open-fem3d-analysis-phi onBlur={(event) => numberOnBlur(event.currentTarget.value, "phi")} /></div>}
    {mode === "custom" && <div className="fem-prop-row"><span className="fem-prop-label">E (MPa)</span>
      <input key={`${material}-e-${choice?.kind === "custom" ? choice.eMpa : baseE}`} className="fem-prop-input"
        type="number" min="0" step="any" defaultValue={choice?.kind === "custom" ? choice.eMpa : baseE}
        data-open-fem3d-analysis-e onBlur={(event) => numberOnBlur(event.currentTarget.value, "eMpa")} /></div>}
    <div className="fem-prop-row"><span className="fem-prop-label">ν</span>
      <input key={`${material}-nu-${current.nu ?? NU_BETON}`} className="fem-prop-input"
        type="number" min="0" max="0.499999" step="any" defaultValue={current.nu ?? NU_BETON}
        data-open-fem3d-analysis-nu onBlur={(event) => numberOnBlur(event.currentTarget.value, "nu")} /></div>
    <p className="fem-prop-hint">{t("openFem3d.props.analysisEffective", {
      e: effective.eMpa.toLocaleString("nl-NL", { maximumFractionDigits: 2 }),
    })}</p>
    {error && <p className="open-fem3d-error" role="alert">{error}</p>}
  </div>;
}
