import { useEffect, useState } from "react";
import type { NativeThreeLayerConfiguration } from "../../core/fem/nativeThreeLayerAdapter";
import { updateFrame3DPlate, type Frame3DModel, type Frame3DPlate } from "./frame3dModel";

interface Props {
  model: Frame3DModel;
  plate: Frame3DPlate;
  onChange: (model: Frame3DModel) => void;
}

type Draft = {
  topSkinMm: string; bottomSkinMm: string;
  topAsX: string; topAsY: string; bottomAsX: string; bottomAsY: string;
  fcdMpa: string; fydMpa: string; nuPrime: string;
  compressionModel: NativeThreeLayerConfiguration["compressionModel"];
  coreEnabled: boolean;
  vRdcKnPerM: string; tanTheta: string; providedShearMm2PerM2: string; diagonalLimitMpa: string;
};

const numberString = (value: number | undefined) => value === undefined ? "" : String(value);

function initialDraft(plate: Frame3DPlate): Draft {
  const saved = plate.threeLayer;
  const fck = Number(/^C(\d+)\//i.exec(plate.material ?? "")?.[1] ?? 30);
  const steel = plate.reinforcement;
  return {
    topSkinMm: numberString(saved?.topSkinMm ?? plate.thicknessM * 250),
    bottomSkinMm: numberString(saved?.bottomSkinMm ?? plate.thicknessM * 250),
    topAsX: numberString(saved?.topReinforcement.asX ?? steel?.topXMm2PerM ?? 0),
    topAsY: numberString(saved?.topReinforcement.asY ?? steel?.topYMm2PerM ?? 0),
    bottomAsX: numberString(saved?.bottomReinforcement.asX ?? steel?.bottomXMm2PerM ?? 0),
    bottomAsY: numberString(saved?.bottomReinforcement.asY ?? steel?.bottomYMm2PerM ?? 0),
    fcdMpa: numberString(saved?.fcdMpa ?? (steel ? steel.alphaCc ?? 1 : 1) * fck / (steel?.gammaC ?? 1.5)),
    fydMpa: numberString(saved?.fydMpa ?? steel?.fydMpa ?? 435),
    nuPrime: numberString(saved?.nuPrime ?? 0.6 * (1 - fck / 250)),
    compressionModel: saved?.compressionModel ?? "blaauwendraad2021",
    coreEnabled: saved?.core !== undefined,
    vRdcKnPerM: numberString(saved?.core?.vRdcKnPerM),
    tanTheta: numberString(saved?.core?.tanTheta ?? steel?.tanTheta ?? 1),
    providedShearMm2PerM2: numberString(saved?.core?.providedShearMm2PerM2 ?? steel?.shearMm2PerM2 ?? 0),
    diagonalLimitMpa: numberString(saved?.core?.diagonalLimitMpa ?? (saved?.fcdMpa ?? fck / 1.5)),
  };
}

const fields: Array<[keyof Draft, string]> = [
  ["topSkinMm", "Bovenhuid dikte [mm]"], ["bottomSkinMm", "Onderhuid dikte [mm]"],
  ["topAsX", "Boven As,x [mm²/m]"], ["topAsY", "Boven As,y [mm²/m]"],
  ["bottomAsX", "Onder As,x [mm²/m]"], ["bottomAsY", "Onder As,y [mm²/m]"],
  ["fcdMpa", "fcd [MPa]"], ["fydMpa", "fyd [MPa]"], ["nuPrime", "ν′"],
];
const coreFields: Array<[keyof Draft, string]> = [
  ["vRdcKnPerM", "vRdc [kN/m]"], ["tanTheta", "tan θ (0,4–1,0)"],
  ["providedShearMm2PerM2", "Aanwezige Asv [mm²/m²]"], ["diagonalLimitMpa", "Drukdiagonaalgrens [MPa]"],
];

export default function Frame3DPlateThreeLayerEditor({ model, plate, onChange }: Props) {
  const [draft, setDraft] = useState<Draft | null>(plate.threeLayer ? initialDraft(plate) : null);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(plate.threeLayer ? initialDraft(plate) : null);
    setError("");
  }, [plate.id, plate.threeLayer]);

  const apply = () => {
    if (!draft) return;
    try {
      const value = (key: keyof Draft) => Number(draft[key]);
      const configuration: NativeThreeLayerConfiguration = {
        topSkinMm: value("topSkinMm"), bottomSkinMm: value("bottomSkinMm"),
        topReinforcement: { asX: value("topAsX"), asY: value("topAsY") },
        bottomReinforcement: { asX: value("bottomAsX"), asY: value("bottomAsY") },
        fcdMpa: value("fcdMpa"), fydMpa: value("fydMpa"), nuPrime: value("nuPrime"),
        compressionModel: draft.compressionModel,
        ...(draft.coreEnabled ? { core: {
          vRdcKnPerM: value("vRdcKnPerM"), tanTheta: value("tanTheta"),
          providedShearMm2PerM2: value("providedShearMm2PerM2"),
          diagonalLimitMpa: value("diagonalLimitMpa"),
        } } : {}),
      };
      onChange(updateFrame3DPlate(model, plate.id, { threeLayer: configuration }));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const clear = () => {
    onChange(updateFrame3DPlate(model, plate.id, { threeLayer: undefined }));
    setDraft(null); setError("");
  };

  return <section className="fem-prop-section">
    <div className="fem-prop-section-title">Blaauwendraad drie-lagencontrole · Rust</div>
    <p className="fem-prop-hint">Controleert plaatmomenten op de resultaatpunten van de hybride Rust-plaat. De getoonde startwaarden zijn voorstellen op basis van plaatdikte, betonklasse en bestaande wapening; controleer en wijzig ze voor het ontwerp. Zonder kerninvoer wordt dwarskracht in de kern niet beoordeeld.</p>
    {!draft ? <button className="fem-prop-kiezer-btn" type="button" onClick={() => setDraft(initialDraft(plate))}>
      Drie-lagencontrole instellen
    </button> : <>
      {fields.map(([key, label]) => <div className="fem-prop-row" key={key}>
        <span className="fem-prop-label">{label}</span><span className="fem-prop-value">
          <input className="fem-prop-input" type="number" step="any" aria-label={`Drielagen ${label}`}
            value={draft[key] as string} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
        </span>
      </div>)}
      <div className="fem-prop-row"><span className="fem-prop-label">Betondrukmodel</span><span className="fem-prop-value">
        <select className="fem-prop-input" aria-label="Drielagen betondrukmodel" value={draft.compressionModel}
          onChange={(event) => setDraft({ ...draft, compressionModel: event.target.value as Draft["compressionModel"] })}>
          <option value="blaauwendraad2021">Blaauwendraad 2021</option>
          <option value="ec2AnnexF">EC2 Bijlage F</option>
        </select>
      </span></div>
      <label className="fem-prop-hint"><input type="checkbox" checked={draft.coreEnabled}
        onChange={(event) => setDraft({ ...draft, coreEnabled: event.target.checked })} /> Kernschuif en verticale wapening toetsen</label>
      {draft.coreEnabled && coreFields.map(([key, label]) => <div className="fem-prop-row" key={key}>
        <span className="fem-prop-label">{label}</span><span className="fem-prop-value">
          <input className="fem-prop-input" type="number" step="any" aria-label={`Drielagen ${label}`}
            value={draft[key] as string} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
        </span>
      </div>)}
      <div className="fem-prop-kiezer-row">
        <button className="fem-prop-kiezer-btn" type="button" onClick={apply}>Drielagencontrole toepassen</button>
        <button className="fem-prop-kiezer-btn" type="button" onClick={clear}>Wissen</button>
      </div>
    </>}
    {error && <p className="frame3d-check-not-ok" role="alert">{error}</p>}
  </section>;
}
