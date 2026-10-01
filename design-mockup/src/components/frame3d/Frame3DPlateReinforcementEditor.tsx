import { useEffect, useState } from "react";
import type { NativeReinforcementSpec } from "../../core/fem/nativePlate2DAdapter";
import { updateFrame3DPlate, type Frame3DModel, type Frame3DPlate } from "./frame3dModel";

interface Props {
  model: Frame3DModel;
  plate: Frame3DPlate;
  onChange: (model: Frame3DModel) => void;
}

function initialSpec(plate: Frame3DPlate): NativeReinforcementSpec {
  const fck = Number(/^C(\d+)\//i.exec(plate.material ?? "")?.[1] ?? 0);
  return { limitState: "ultimate", fckMpa: fck, fctmMpa: fck === 30 ? 2.9 : 0,
    gammaC: 1.5, fydMpa: 435, fywdMpa: 435, esMpa: 200000,
    coverMm: 30, barDiameterMm: 12,
    topXMm2PerM: 0, topYMm2PerM: 0, bottomXMm2PerM: 0, bottomYMm2PerM: 0,
    shearMm2PerM2: 0, tanTheta: 1, alphaCc: 1, longTerm: false };
}

const fields: Array<[keyof NativeReinforcementSpec, string]> = [
  ["fckMpa", "fck [MPa]"], ["fctmMpa", "fctm [MPa]"], ["gammaC", "γc"],
  ["fydMpa", "fyd [MPa]"], ["fywdMpa", "fywd [MPa]"], ["esMpa", "Es [MPa]"],
  ["coverMm", "Dekking [mm]"], ["barDiameterMm", "Staafdiameter [mm]"],
  ["topXMm2PerM", "Boven X [mm²/m]"], ["topYMm2PerM", "Boven Y [mm²/m]"],
  ["bottomXMm2PerM", "Onder X [mm²/m]"], ["bottomYMm2PerM", "Onder Y [mm²/m]"],
  ["shearMm2PerM2", "Dwarskrachtwapening [mm²/m²]"], ["tanTheta", "tan θ"],
  ["alphaCc", "αcc"], ["leverArmMm", "Hefboomarm [mm, optioneel]"],
  ["cRdc", "C_Rd,c [optioneel]"], ["crackLimitMm", "Scheurgrens [mm, optioneel]"],
];

export default function Frame3DPlateReinforcementEditor({ model, plate, onChange }: Props) {
  const [draft, setDraft] = useState<NativeReinforcementSpec | null>(plate.reinforcement ?? null);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(plate.reinforcement ?? null); setError(""); }, [plate.id, plate.reinforcement]);
  const apply = () => {
    if (!draft) return;
    try {
      onChange(updateFrame3DPlate(model, plate.id, { reinforcement: draft }));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const clear = () => {
    onChange(updateFrame3DPlate(model, plate.id, { reinforcement: undefined }));
    setDraft(null); setError("");
  };
  return <section className="fem-prop-section">
    <div className="fem-prop-section-title">Plaatwapening · Rust</div>
    <p className="fem-prop-hint">Voer de toetswaarden voor één UGT- of BGT-rekengang expliciet in. Kies de bijbehorende belasting of combinatie bij Berekenen. Het resultaat is een steekpuntenomhulling per plaatelement.</p>
    {!draft ? <button className="fem-prop-kiezer-btn" type="button" onClick={() => setDraft(initialSpec(plate))}>Wapeningsinvoer starten</button> : <>
      <div className="fem-prop-row"><span className="fem-prop-label">Toestand</span><span className="fem-prop-value">
        <select className="fem-prop-input" aria-label="Plaat grenstoestand" value={draft.limitState}
          onChange={(event) => setDraft({ ...draft, limitState: event.target.value as "ultimate" | "service" })}>
          <option value="ultimate">UGT · wapening en dwarskracht</option><option value="service">BGT · scheurwijdte</option>
        </select></span></div>
      {fields.map(([key, label]) => <div className="fem-prop-row" key={key}>
        <span className="fem-prop-label">{label}</span><span className="fem-prop-value"><input className="fem-prop-input" type="number" step="any"
          aria-label={`Plaat ${label}`} value={draft[key] as number | undefined ?? ""}
          onChange={(event) => {
            const value = event.target.value === "" && ["leverArmMm", "cRdc", "crackLimitMm"].includes(key)
              ? undefined : Number(event.target.value);
            setDraft({ ...draft, [key]: value });
          }} /></span>
      </div>)}
      {draft.limitState === "service" && <label className="fem-prop-hint"><input type="checkbox" checked={draft.longTerm ?? false}
        onChange={(event) => setDraft({ ...draft, longTerm: event.target.checked })} /> Langdurige BGT-belasting</label>}
      <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" type="button" onClick={apply}>Wapening toepassen</button>
        <button className="fem-prop-kiezer-btn" type="button" onClick={clear}>Wissen</button></div>
    </>}
    {error && <p className="frame3d-check-not-ok" role="alert">{error}</p>}
  </section>;
}
