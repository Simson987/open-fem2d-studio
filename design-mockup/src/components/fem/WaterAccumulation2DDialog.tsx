import { useEffect, useState } from "react";
import Modal from "../Modal";
import { calculateWaterAccumulation2D, type WaterAccumulation2DResult } from "../../lib/waterAccumulation2d";
import "./WaterAccumulation2DDialog.css";

interface Props {
  open: boolean;
  onClose: () => void;
  selectedBeam?: { id: number; spanM: number; eiKnm2: number } | null;
}

export default function WaterAccumulation2DDialog({ open, onClose, selectedBeam }: Props) {
  const [span, setSpan] = useState("6");
  const [width, setWidth] = useState("3");
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
    setSpan(String(Number(selectedBeam.spanM.toFixed(3))));
    setEi(String(Number(selectedBeam.eiKnm2.toFixed(2))));
    setResult(null);
  }, [open, selectedBeam?.id, selectedBeam?.spanM, selectedBeam?.eiKnm2]);

  const calculate = () => {
    try {
      const next = calculateWaterAccumulation2D({
        spanM: Number(span), tributaryWidthM: Number(width), eiKnm2: Number(ei),
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
  const field = (label: string, value: string, setValue: (value: string) => void, unit: string) =>
    <label className="water2d-field"><span>{label}</span><div><input type="number" step="any" value={value}
      onChange={(event) => { setValue(event.target.value); setResult(null); }} /><small>{unit}</small></div></label>;
  const maxDepth = result ? Math.max(100, result.maxWaterDepthM * 1000) : 100;
  const depthPath = result ? result.points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${(point.xM / Number(span) * 480).toFixed(1)} ${(18 + point.waterDepthMm / maxDepth * 120).toFixed(1)}`).join(" ") : "";
  return <Modal open={open} onClose={onClose} title="Wateraccumulatie · 2D liggerstrook" width={650}
    footer={<><button type="button" onClick={onClose}>Sluiten</button><button type="button" className="primary" onClick={calculate}>Berekenen</button></>}>
    <div className="water2d-dialog">
      <p>Iteratieve berekening van waterhoogte en doorbuiging voor één vrij opgelegde dakligger. {selectedBeam
        ? `Lengte en buigstijfheid van staaf ${selectedBeam.id} zijn ingevuld.`
        : "Vul de liggergegevens in."}</p>
      <div className="water2d-fields">
        {field("Overspanning", span, setSpan, "m")}
        {field("Meewerkende dakbreedte", width, setWidth, "m")}
        {field("Buigstijfheid EI", ei, setEi, "kNm²")}
        {field("Waterpeil boven linker dakrand", level, setLevel, "mm")}
        {field("Afschot omhoog naar rechts", slope, setSlope, "%")}
        {field("Zeeg omhoog in midden", camber, setCamber, "mm")}
        {field("Begindoorbuiging in midden", sag, setSag, "mm")}
        <label className="water2d-field"><span>Stijfheidsfactor γM</span><div><select value={modelFactor}
          onChange={(event) => { setModelFactor(event.target.value); setResult(null); }}>
          <option value="1">1,0 · zonder reductie</option>
          <option value="1.3">1,3 · voorbeeld 2006</option>
        </select></div></label>
      </div>
      {error && <p role="alert" className="water2d-error">{error}</p>}
      {result && <div className="water2d-result" aria-live="polite">
        <strong className={result.status === "converged" ? "water2d-ok" : "water2d-error"}>
          {result.status === "converged" ? "Evenwicht gevonden" : "Geen convergent evenwicht gevonden"}
        </strong>
        {result.status === "converged" && <div className="water2d-metrics">
          <span>Stijfheidgetal n <b>{result.stiffnessRatio.toFixed(2)}</b></span>
          <span>Rekenstijfheid EI/γM <b>{result.effectiveEiKnm2.toFixed(0)} kNm²</b></span>
          <span>Max. waterdiepte <b>{(result.maxWaterDepthM * 1000).toFixed(1)} mm</b></span>
          <span>Max. doorbuiging <b>{result.maxDeflectionMm.toFixed(1)} mm</b></span>
          <span>Max. moment door water <b>{result.maxMomentKnm.toFixed(2)} kNm</b></span>
          <span>Geborgen watervolume <b>{result.waterVolumeM3.toFixed(2)} m³</b></span>
          <span>Waterlast <b>{result.totalWaterLoadKn.toFixed(2)} kN</b></span>
          <span>Reacties <b>{result.reactionsKn.map((reaction) => reaction.toFixed(2)).join(" / ")} kN</b></span>
        </div>}
        {result.status === "converged" && result.stiffnessRatio <= 1 &&
          <p className="water2d-note">Stijfheidgetal ≤ 1: dit evenwicht bij het ingevoerde peil kan bestaan bij afschot of een deels droog dak. De maximale wateropvoerhoogte is hiermee nog niet bepaald; daarvoor moet het watervolume stapsgewijs worden opgevoerd.</p>}
        {result.status === "unstable" && <p className="water2d-error">De iteratie bij vast waterpeil convergeert niet. Daarmee is instabiliteit nog niet aangetoond; controleer stijfheid, zeeg en afschot met een volumegestuurde berekening. De tussenwaarden zijn geen ontwerpresultaat.</p>}
        {result.status === "converged" && <svg className="water2d-profile" viewBox="0 0 480 160" role="img" aria-label="Waterdiepte langs de 2D-dakligger">
          <path d="M 0 18 H 480" stroke="#0284c7" strokeWidth="2" />
          <path d={`${depthPath} L 480 18 L 0 18 Z`} fill="#38bdf833" stroke="none" />
          <path d={depthPath} fill="none" stroke="#334155" strokeWidth="2" />
          <text x="8" y="13">waterpeil</text>
        </svg>}
        <p className="water2d-note">Model: één dakstrook met vrij opgelegde uiteinden; waterpeil blijft vast op de ingevoerde hoogte. Dit is een berekening, nog geen NPR 6703-normtoets of afvoercontrole. {result.iterations} iteraties.</p>
      </div>}
      <p className="water2d-source">Bronnen: <a href="https://gratis-publicaties.bouwenmetstaal.nl/pdf_serve/?n=Wateraccumulatie+%28Technisch+dossier+%231%29-1.pdf&p=pdf&pub=176-1.pdf" target="_blank" rel="noreferrer">Blaauwendraad, praktische methode (2006)</a> en <a href="https://heronjournal.nl/67-2/3.pdf" target="_blank" rel="noreferrer">instructiemodel met volumesturing (2022)</a>. De volumegestuurde methode is nog niet in deze berekening opgenomen.</p>
    </div>
  </Modal>;
}
