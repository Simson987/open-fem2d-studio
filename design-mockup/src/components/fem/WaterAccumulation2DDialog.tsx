import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../Modal";
import { calculateWaterAccumulation2D, type WaterAccumulation2DResult } from "../../lib/waterAccumulation2d";
import { formatLength, parseLength } from "../../lib/lengthInput";
import { openExternal } from "../../lib/tauri";
import "./WaterAccumulation2DDialog.css";

const BRON_2006 = "https://gratis-publicaties.bouwenmetstaal.nl/pdf_serve/?n=Wateraccumulatie+%28Technisch+dossier+%231%29-1.pdf&p=pdf&pub=176-1.pdf";
const BRON_2022 = "https://heronjournal.nl/67-2/3.pdf";

/**
 * Bronlink via de gedeelde helper (#38): in de app de standaardbrowser, anders
 * een nieuw tabblad. preventDefault houdt ook het klikscript van de
 * opener-plugin erbuiten (dat opent een target="_blank"-link anders zelf,
 * zonder terugval).
 */
const openBron = (url: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  void openExternal(url);
};

interface Props {
  open: boolean;
  onClose: () => void;
  selectedBeam?: { id: number; spanM: number; eiKnm2: number } | null;
}

export default function WaterAccumulation2DDialog({ open, onClose, selectedBeam }: Props) {
  const { t } = useTranslation("common");
  // Overspanning en dakbreedte worden in mm getypt (issue #36); de rekenkern
  // krijgt meters.
  const [span, setSpan] = useState("6000");
  const [width, setWidth] = useState("3000");
  const [ei, setEi] = useState("10000");
  const [level, setLevel] = useState("100");
  const [slope, setSlope] = useState("0");
  const [camber, setCamber] = useState("0");
  const [sag, setSag] = useState("0");
  const [modelFactor, setModelFactor] = useState("1");
  const [result, setResult] = useState<WaterAccumulation2DResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !selectedBeam) return;
    setSpan(formatLength(Number(selectedBeam.spanM.toFixed(3)), "m"));
    setEi(String(Number(selectedBeam.eiKnm2.toFixed(2))));
    setResult(null);
  }, [open, selectedBeam?.id, selectedBeam?.spanM, selectedBeam?.eiKnm2]);

  const calculate = () => {
    try {
      const next = calculateWaterAccumulation2D({
        spanM: parseLength(span, "m"), tributaryWidthM: parseLength(width, "m"), eiKnm2: Number(ei),
        waterLevelAboveLeftM: Number(level) / 1000,
        slopePercent: Number(slope), camberMm: Number(camber), initialSagMm: Number(sag),
        stiffnessModelFactor: Number(modelFactor),
      });
      setResult(next);
      setError(null);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  // Lengtevelden zijn tekst met een decimaal toetsenbord, zodat 6000,5 mag.
  const field = (label: string, value: string, setValue: (value: string) => void, unit: string, lengte = false) =>
    <label className="water2d-field"><span>{label}</span><div><input type={lengte ? "text" : "number"}
      inputMode={lengte ? "decimal" : undefined} step={lengte ? undefined : "any"} value={value}
      onChange={(event) => { setValue(event.target.value); setResult(null); }} /><small>{unit}</small></div></label>;
  const maxDepth = result ? Math.max(100, result.maxWaterDepthM * 1000) : 100;
  const depthPath = result ? result.points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${(point.xM / parseLength(span, "m") * 480).toFixed(1)} ${(18 + point.waterDepthMm / maxDepth * 120).toFixed(1)}`).join(" ") : "";
  return <Modal open={open} onClose={onClose} title={t("waterAccumulatie.title")} width={650}
    footer={<><button type="button" onClick={onClose}>{t("close")}</button><button type="button" className="primary" onClick={calculate}>{t("waterAccumulatie.calculate")}</button></>}>
    <div className="water2d-dialog">
      <p>{t("waterAccumulatie.intro")} {selectedBeam
        ? t("waterAccumulatie.introBeam", { id: selectedBeam.id })
        : t("waterAccumulatie.introManual")}</p>
      <div className="water2d-fields">
        {field(t("waterAccumulatie.span"), span, setSpan, "mm", true)}
        {field(t("waterAccumulatie.tributaryWidth"), width, setWidth, "mm", true)}
        {field(t("waterAccumulatie.bendingStiffness"), ei, setEi, "kNm²")}
        {field(t("waterAccumulatie.waterLevel"), level, setLevel, "mm")}
        {field(t("waterAccumulatie.slope"), slope, setSlope, "%")}
        {field(t("waterAccumulatie.camber"), camber, setCamber, "mm")}
        {field(t("waterAccumulatie.initialSag"), sag, setSag, "mm")}
        <label className="water2d-field"><span>{t("waterAccumulatie.stiffnessFactor")}</span><div><select value={modelFactor}
          onChange={(event) => { setModelFactor(event.target.value); setResult(null); }}>
          <option value="1">{t("waterAccumulatie.factorNone")}</option>
          <option value="1.3">{t("waterAccumulatie.factorExample2006")}</option>
        </select></div></label>
      </div>
      {error && <p role="alert" className="water2d-error">{error}</p>}
      {result && <div className="water2d-result" aria-live="polite">
        <strong className={result.status === "converged" ? "water2d-ok" : "water2d-error"}>
          {result.status === "converged" ? t("waterAccumulatie.converged") : t("waterAccumulatie.notConverged")}
        </strong>
        {result.status === "converged" && <div className="water2d-metrics">
          <span>{t("waterAccumulatie.stiffnessRatio")} <b>{result.stiffnessRatio.toFixed(2)}</b></span>
          <span>{t("waterAccumulatie.designStiffness")} <b>{result.effectiveEiKnm2.toFixed(0)} kNm²</b></span>
          <span>{t("waterAccumulatie.maxWaterDepth")} <b>{(result.maxWaterDepthM * 1000).toFixed(1)} mm</b></span>
          <span>{t("waterAccumulatie.maxDeflection")} <b>{result.maxDeflectionMm.toFixed(1)} mm</b></span>
          <span>{t("waterAccumulatie.maxMoment")} <b>{result.maxMomentKnm.toFixed(2)} kNm</b></span>
          <span>{t("waterAccumulatie.waterVolume")} <b>{result.waterVolumeM3.toFixed(2)} m³</b></span>
          <span>{t("waterAccumulatie.waterLoad")} <b>{result.totalWaterLoadKn.toFixed(2)} kN</b></span>
          <span>{t("waterAccumulatie.reactions")} <b>{result.reactionsKn.map((reaction) => reaction.toFixed(2)).join(" / ")} kN</b></span>
        </div>}
        {result.status === "converged" && result.stiffnessRatio <= 1 &&
          <p className="water2d-note">{t("waterAccumulatie.lowStiffnessNote")}</p>}
        {result.status === "unstable" && <p className="water2d-error">{t("waterAccumulatie.unstableNote")}</p>}
        {result.status === "converged" && <svg className="water2d-profile" viewBox="0 0 480 160" role="img" aria-label={t("waterAccumulatie.profileAria")}>
          <path d="M 0 18 H 480" stroke="#0284c7" strokeWidth="2" />
          <path d={`${depthPath} L 480 18 L 0 18 Z`} fill="#38bdf833" stroke="none" />
          <path d={depthPath} fill="none" stroke="#334155" strokeWidth="2" />
          <text x="8" y="13">{t("waterAccumulatie.waterLevelLabel")}</text>
        </svg>}
        <p className="water2d-note">{t("waterAccumulatie.modelNote", { n: result.iterations })}</p>
      </div>}
      <p className="water2d-source">{t("waterAccumulatie.sources")} <a href={BRON_2006} target="_blank" rel="noreferrer" onClick={openBron(BRON_2006)}>{t("waterAccumulatie.source2006")}</a> {t("waterAccumulatie.sourcesAnd")} <a href={BRON_2022} target="_blank" rel="noreferrer" onClick={openBron(BRON_2022)}>{t("waterAccumulatie.source2022")}</a>. {t("waterAccumulatie.sourcesNote")}</p>
    </div>
  </Modal>;
}
