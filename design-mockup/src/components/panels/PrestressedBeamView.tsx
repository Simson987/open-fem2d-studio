import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  solveNativePrestressedBeam,
  type NativePrestressedBeamResult,
} from "../../lib/nativeFemClient";
import {
  buildPrestressedBeamInput,
  INITIAL_PRESTRESSED_BEAM_FIELDS,
  type PrestressedBeamFields,
  type PrestressedBeamLineLoad,
  type PrestressedBeamPointLoad,
} from "../../lib/prestressedBeamInput";
import PrestressedBeamCrackWidthCheck from "./PrestressedBeamCrackWidthCheck";
import "./PrestressedBeamView.css";

export default function PrestressedBeamView() {
  const { t } = useTranslation("ribbon");
  const [fields, setFields] = useState(INITIAL_PRESTRESSED_BEAM_FIELDS);
  const [result, setResult] = useState<NativePrestressedBeamResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type NumericField = Exclude<keyof PrestressedBeamFields,
    "segmentModuliMpa" | "segmentBoundariesM" | "transferPointLoads" | "servicePointLoads"
    | "transferLineLoads" | "serviceLineLoads">;
  const update = (name: NumericField, value: string) => {
    const nextValue = Number(value);
    setFields((current) => ({
      ...current,
      [name]: nextValue,
      ...(name === "spanM" && Number.isFinite(nextValue) && current.spanM > 0 ? {
        segmentBoundariesM: current.segmentBoundariesM.map((position) => position * nextValue / current.spanM),
      } : {}),
    }));
  };

  const setSegmentCount = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const count = Math.max(1, Math.min(12, Math.round(parsed)));
    setFields((current) => ({
      ...current,
      segmentModuliMpa: Array.from({ length: count }, (_, index) =>
        current.segmentModuliMpa[index]
          ?? current.segmentModuliMpa[current.segmentModuliMpa.length - 1] ?? 30_000),
      segmentBoundariesM: Array.from({ length: count - 1 }, (_, index) =>
        current.spanM * (index + 1) / count),
    }));
  };

  const updateSegmentModulus = (index: number, value: string) => {
    const eMpa = Number(value);
    setFields((current) => ({
      ...current,
      segmentModuliMpa: current.segmentModuliMpa.map((currentE, currentIndex) =>
        currentIndex === index ? eMpa : currentE),
    }));
  };

  const updateSegmentBoundary = (index: number, value: string) => {
    const position = Number(value);
    setFields((current) => ({
      ...current,
      segmentBoundariesM: current.segmentBoundariesM.map((currentPosition, currentIndex) =>
        currentIndex === index ? position : currentPosition),
    }));
  };

  const updatePointLoad = (phase: "transfer" | "service", index: number,
    key: keyof PrestressedBeamPointLoad, value: string) => {
    const parsed = Number(value);
    const fieldName = phase === "transfer" ? "transferPointLoads" : "servicePointLoads";
    setFields((current) => ({
      ...current,
      [fieldName]: current[fieldName].map((load, loadIndex) => loadIndex === index
        ? { ...load, [key]: parsed } : load),
    }));
  };

  const addPointLoad = (phase: "transfer" | "service") => {
    const fieldName = phase === "transfer" ? "transferPointLoads" : "servicePointLoads";
    setFields((current) => ({
      ...current,
      [fieldName]: [...current[fieldName], { positionM: current.spanM / 2, downwardKn: 0 }],
    }));
  };

  const removePointLoad = (phase: "transfer" | "service", index: number) => {
    const fieldName = phase === "transfer" ? "transferPointLoads" : "servicePointLoads";
    setFields((current) => ({
      ...current,
      [fieldName]: current[fieldName].filter((_, loadIndex) => loadIndex !== index),
    }));
  };

  const pointLoadFields = (phase: "transfer" | "service") => {
    const loads = phase === "transfer" ? fields.transferPointLoads : fields.servicePointLoads;
    return (
      <div className="prestressed-beam-load-list">
        {loads.map((load, index) => (
          <Fragment key={`${phase}-point-${index}`}>
            <label className="prestressed-beam-field">
              <span>{t(`insights.prestressedBeam.${phase}PointPosition`, { index: index + 1 })}</span>
              <span className="prestressed-beam-input-wrap">
                <input type="number" step="0.01" value={load.positionM}
                  onChange={(event) => updatePointLoad(phase, index, "positionM", event.target.value)} />
                <span>m</span>
              </span>
            </label>
            <label className="prestressed-beam-field">
              <span>{t(`insights.prestressedBeam.${phase}PointLoad`, { index: index + 1 })}</span>
              <span className="prestressed-beam-input-wrap">
                <input type="number" step="0.1" value={load.downwardKn}
                  onChange={(event) => updatePointLoad(phase, index, "downwardKn", event.target.value)} />
                <span>kN</span>
              </span>
            </label>
            <button type="button" className="prestressed-beam-load-remove"
              aria-label={t("insights.prestressedBeam.removePointLoad", { index: index + 1 })}
              onClick={() => removePointLoad(phase, index)}>
              {t("insights.prestressedBeam.removeLoad")}
            </button>
          </Fragment>
        ))}
        <button type="button" className="prestressed-beam-load-add" onClick={() => addPointLoad(phase)}>
          {t(`insights.prestressedBeam.add${phase === "transfer" ? "Transfer" : "Service"}PointLoad`)}
        </button>
      </div>
    );
  };

  const updateLineLoad = (phase: "transfer" | "service", index: number,
    key: keyof PrestressedBeamLineLoad, value: string) => {
    const parsed = Number(value);
    const fieldName = phase === "transfer" ? "transferLineLoads" : "serviceLineLoads";
    setFields((current) => ({
      ...current,
      [fieldName]: current[fieldName].map((load, loadIndex) => loadIndex === index
        ? { ...load, [key]: parsed } : load),
    }));
  };

  const addLineLoad = (phase: "transfer" | "service") => {
    const fieldName = phase === "transfer" ? "transferLineLoads" : "serviceLineLoads";
    setFields((current) => ({
      ...current,
      [fieldName]: [...current[fieldName], {
        startM: 0, endM: current.spanM,
        startDownwardKnPerM: 0, endDownwardKnPerM: 0,
      }],
    }));
  };

  const removeLineLoad = (phase: "transfer" | "service", index: number) => {
    const fieldName = phase === "transfer" ? "transferLineLoads" : "serviceLineLoads";
    setFields((current) => ({
      ...current,
      [fieldName]: current[fieldName].filter((_, loadIndex) => loadIndex !== index),
    }));
  };

  const lineLoadFields = (phase: "transfer" | "service") => {
    const loads = phase === "transfer" ? fields.transferLineLoads : fields.serviceLineLoads;
    const names = phase === "transfer" ? {
      start: "transferLineStart", end: "transferLineEnd",
      startLoad: "transferLineStartLoad", endLoad: "transferLineEndLoad",
    } : {
      start: "serviceLineStart", end: "serviceLineEnd",
      startLoad: "serviceLineStartLoad", endLoad: "serviceLineEndLoad",
    };
    return (
      <div className="prestressed-beam-load-list">
        {loads.map((load, index) => (
          <Fragment key={`${phase}-line-${index}`}>
            {([["startM", names.start, "m"], ["endM", names.end, "m"],
              ["startDownwardKnPerM", names.startLoad, "kN/m"],
              ["endDownwardKnPerM", names.endLoad, "kN/m"]] as const).map(([key, label, unit]) => (
              <label className="prestressed-beam-field" key={key}>
                <span>{t(`insights.prestressedBeam.${label}`, { index: index + 1 })}</span>
                <span className="prestressed-beam-input-wrap">
                  <input type="number" step={unit === "m" ? "0.01" : "0.1"} value={load[key]}
                    onChange={(event) => updateLineLoad(phase, index, key, event.target.value)} />
                  <span>{unit}</span>
                </span>
              </label>
            ))}
            <button type="button" className="prestressed-beam-load-remove"
              aria-label={t("insights.prestressedBeam.removeLineLoad", { index: index + 1 })}
              onClick={() => removeLineLoad(phase, index)}>
              {t("insights.prestressedBeam.removeLoad")}
            </button>
          </Fragment>
        ))}
        <button type="button" className="prestressed-beam-load-add" onClick={() => addLineLoad(phase)}>
          {t(`insights.prestressedBeam.add${phase === "transfer" ? "Transfer" : "Service"}LineLoad`)}
        </button>
      </div>
    );
  };

  const calculate = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await solveNativePrestressedBeam(buildPrestressedBeamInput(fields)));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const field = (name: NumericField, label: string, unit: string, step = "any") => (
    <label className="prestressed-beam-field" key={name}>
      <span>{label}</span>
      <span className="prestressed-beam-input-wrap">
        <input
          type="number"
          step={step}
          value={fields[name]}
          onChange={(event) => update(name, event.target.value)}
        />
        <span>{unit}</span>
      </span>
    </label>
  );

  const number = (value: number, digits = 3) => new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);

  return (
    <main className="prestressed-beam-view">
      <header className="prestressed-beam-header">
        <div>
          <h1>{t("insights.prestressedBeam.title")}</h1>
          <p>{t("insights.prestressedBeam.subtitle")}</p>
        </div>
        <button type="button" className="prestressed-beam-calculate" onClick={calculate} disabled={busy}>
          {busy ? t("insights.prestressedBeam.calculating") : t("insights.prestressedBeam.calculate")}
        </button>
      </header>

      <section className="prestressed-beam-card">
        <h2>{t("insights.prestressedBeam.geometry")}</h2>
        <div className="prestressed-beam-grid">
          {field("spanM", t("insights.prestressedBeam.span"), "m", "0.1")}
          {field("areaM2", t("insights.prestressedBeam.area"), "m²", "0.001")}
          {field("inertiaM4", t("insights.prestressedBeam.inertia"), "m⁴", "0.0001")}
          {field("fibreDepthM", t("insights.prestressedBeam.fibreDepth"), "m", "0.001")}
          <label className="prestressed-beam-field" key="segment-count">
            <span>{t("insights.prestressedBeam.segmentCount")}</span>
            <span className="prestressed-beam-input-wrap">
              <input type="number" min="1" max="12" step="1"
                value={fields.segmentModuliMpa.length} onChange={(event) => setSegmentCount(event.target.value)} />
              <span>{t("insights.prestressedBeam.segmentsUnit")}</span>
            </span>
          </label>
          {fields.segmentModuliMpa.map((eMpa, index) => (
            <Fragment key={`segment-e-${index}`}>
              <label className="prestressed-beam-field">
                <span>{t("insights.prestressedBeam.segmentModulus", { index: index + 1 })}</span>
                <span className="prestressed-beam-input-wrap">
                  <input type="number" step="100" value={eMpa}
                    onChange={(event) => updateSegmentModulus(index, event.target.value)} />
                  <span>MPa</span>
                </span>
              </label>
              {index < fields.segmentModuliMpa.length - 1 && (
                <label className="prestressed-beam-field">
                  <span>{t("insights.prestressedBeam.segmentBoundary", { index: index + 1 })}</span>
                  <span className="prestressed-beam-input-wrap">
                    <input type="number" min="0" max={fields.spanM} step="0.01"
                      value={fields.segmentBoundariesM[index]}
                      onChange={(event) => updateSegmentBoundary(index, event.target.value)} />
                    <span>m</span>
                  </span>
                </label>
              )}
            </Fragment>
          ))}
        </div>
        <p className="prestressed-beam-help">{t("insights.prestressedBeam.modulusHelp")}</p>
      </section>

      <section className="prestressed-beam-card">
        <h2>{t("insights.prestressedBeam.prestressAndLoads")}</h2>
        <div className="prestressed-beam-grid">
          {field("initialForceKn", t("insights.prestressedBeam.initialForce"), "kN", "1")}
          {field("lossPercent", t("insights.prestressedBeam.loss"), "%", "1")}
          {field("tendonEndM", t("insights.prestressedBeam.tendonEnd"), "m", "0.01")}
          {field("tendonMidM", t("insights.prestressedBeam.tendonMid"), "m", "0.01")}
          {field("transferLoadKnPerM", t("insights.prestressedBeam.transferLoad"), "kN/m", "0.1")}
          {field("serviceLoadKnPerM", t("insights.prestressedBeam.serviceLoad"), "kN/m", "0.1")}
          {pointLoadFields("transfer")}
          {pointLoadFields("service")}
          {lineLoadFields("transfer")}
          {lineLoadFields("service")}
        </div>
      </section>

      <section className="prestressed-beam-card">
        <h2>{t("insights.prestressedBeam.shearLinksTitle")}</h2>
        <div className="prestressed-beam-grid">
          {field("webWidthMm", t("insights.prestressedBeam.webWidth"), "mm", "1")}
          {field("effectiveDepthMm", t("insights.prestressedBeam.effectiveDepth"), "mm", "1")}
          {field("leverArmMm", t("insights.prestressedBeam.leverArm"), "mm", "1")}
          {field("alphaCW", t("insights.prestressedBeam.alphaCW"), "–", "0.01")}
          {field("nu1", t("insights.prestressedBeam.nu1"), "–", "0.01")}
          {field("fcdMpa", t("insights.prestressedBeam.fcd"), "MPa", "0.1")}
          {field("fywdMpa", t("insights.prestressedBeam.fywd"), "MPa", "1")}
          {field("cotTheta", t("insights.prestressedBeam.cotTheta"), "–", "0.1")}
          {field("providedAswMm2", t("insights.prestressedBeam.providedAsw"), "mm²", "1")}
          {field("providedSpacingMm", t("insights.prestressedBeam.providedSpacing"), "mm", "1")}
        </div>
        <p className="prestressed-beam-help">{t("insights.prestressedBeam.shearHelp")}</p>
      </section>

      <PrestressedBeamCrackWidthCheck />

      {error && <div className="prestressed-beam-error" role="alert">{error}</div>}

      {result && (
        <>
          <section className="prestressed-beam-summary-grid" aria-label={t("insights.prestressedBeam.results")}>
            {(["transfer", "service"] as const).map((stage) => {
              const item = result[stage];
              return (
                <article className="prestressed-beam-card prestressed-beam-summary" key={stage}>
                  <h2>{t(`insights.prestressedBeam.${stage}`)}</h2>
                  <dl>
                    <div><dt>{t("insights.prestressedBeam.force")}</dt><dd>{number(item.forceKn)} kN</dd></div>
                    <div><dt>{t("insights.prestressedBeam.leftReaction")}</dt><dd>{number(item.leftReactionKn)} kN</dd></div>
                    <div><dt>{t("insights.prestressedBeam.rightReaction")}</dt><dd>{number(item.rightReactionKn)} kN</dd></div>
                    <div><dt>{t("insights.prestressedBeam.midspanDeflection")}</dt><dd>{number(item.totalMidspanDeflectionM * 1000, 4)} mm</dd></div>
                  </dl>
                </article>
              );
            })}
          </section>
          <section className="prestressed-beam-card prestressed-beam-table-card">
            <h2>{t("insights.prestressedBeam.serviceStations")}</h2>
            <div className="prestressed-beam-table-scroll">
              <table>
                <thead><tr>
                  <th>{t("insights.prestressedBeam.position")}</th>
                  <th>{t("insights.prestressedBeam.effectiveE")}</th>
                  <th>{t("insights.prestressedBeam.moment")}</th>
                  <th>{t("insights.prestressedBeam.shear")}</th>
                  <th>{t("insights.prestressedBeam.topStress")}</th>
                  <th>{t("insights.prestressedBeam.bottomStress")}</th>
                  <th>{t("insights.prestressedBeam.deflection")}</th>
                  <th>{t("insights.prestressedBeam.requiredAsw")}</th>
                  <th>{t("insights.prestressedBeam.providedUtilization")}</th>
                </tr></thead>
                <tbody>{result.service.stations.map((station) => (
                  <tr key={station.xM}>
                    <td>{number(station.xM, 4)} m</td>
                    <td>{number(station.effectiveEMpa, 0)} MPa</td>
                    <td>{number(station.totalMomentKnm)} kNm</td>
                    <td>{number(station.shearKn)} kN</td>
                    <td>{number(station.fibreStress.topMpa)} MPa</td>
                    <td>{number(station.fibreStress.bottomMpa)} MPa</td>
                    <td>{number(station.totalDeflectionM * 1000, 4)} mm</td>
                    <td>{station.shearLinks ? `${number(station.shearLinks.requiredAswPerSpacingMm2PerMm * 1000, 1)} mm²/m` : "—"}</td>
                    <td>{station.shearLinks?.utilizationProvidedLinks === undefined ? "—" : number(station.shearLinks.utilizationProvidedLinks, 3)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
