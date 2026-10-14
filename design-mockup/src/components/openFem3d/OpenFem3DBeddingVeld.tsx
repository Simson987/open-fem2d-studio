import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import LengthInput from "../LengthInput";
import {
  openFem3DBeamIsColumn, openFem3DBeddingAllRound, setOpenFem3DBeamBedding, type OpenFem3DBeamBedding, type OpenFem3DModel,
} from "./openFem3dModel";
import { OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3, openFem3DBeddingSummary } from "./openFem3dBedding";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";

/** Een bedding in wording: velden mogen nog ontbreken (zoals b direct na aanvinken). */
interface Concept {
  kKnPerM3?: number;
  widthM?: number;
  kLateralKnPerM3?: number;
  compressionOnly: boolean;
}

/** Volledig genoeg om te zetten: b en minstens één constante. */
function compleet(concept: Concept): OpenFem3DBeamBedding | null {
  if (!(concept.widthM !== undefined && concept.widthM > 0)) return null;
  if (concept.kKnPerM3 === undefined && concept.kLateralKnPerM3 === undefined) return null;
  return {
    ...(concept.kKnPerM3 !== undefined ? { kKnPerM3: concept.kKnPerM3 } : {}),
    widthM: concept.widthM,
    ...(concept.kLateralKnPerM3 !== undefined ? { kLateralKnPerM3: concept.kLateralKnPerM3 } : {}),
    ...(concept.compressionOnly && concept.kKnPerM3 !== undefined ? { compressionOnly: true } : {}),
  };
}

/** Tekst → getal; leeg = undefined, ongeldig = NaN. Een komma telt als decimaalteken. */
function leesGetal(tekst: string): number | undefined {
  const schoon = tekst.trim().replace(",", ".");
  if (!schoon) return undefined;
  const getal = Number(schoon);
  return Number.isFinite(getal) ? getal : Number.NaN;
}

/**
 * Een getalveld dat pas bij verlaten of Enter doorgeeft. Een ongeldige of
 * niet-positieve waarde zet de vorige tekst terug; leeg geeft undefined (als
 * `optional`), anders ook de vorige tekst. Ook voor de plaatbedding (#107).
 */
export function GetalVeld({ value, optional, onCommit, ...props }: {
  value: number | undefined;
  optional?: boolean;
  onCommit: (value: number | undefined) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const toon = value === undefined ? "" : String(value);
  const [tekst, setTekst] = useState(toon);
  useEffect(() => setTekst(toon), [toon]);
  const bevestig = () => {
    const getal = leesGetal(tekst);
    if (getal === undefined && optional) { if (value !== undefined) onCommit(undefined); return; }
    if (getal === undefined || Number.isNaN(getal) || getal <= 0) { setTekst(toon); return; }
    if (getal !== value) onCommit(getal);
  };
  return <input {...props} className="fem-prop-input" type="text" inputMode="decimal" value={tekst}
    onChange={(event) => setTekst(event.target.value)}
    onBlur={bevestig}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

/**
 * "Op bedding" (issue #106) voor één staaf of een selectie van staven: k
 * (kN/m³), de contactbreedte b in mm, optioneel een zijdelingse k en "alleen
 * druk". Standaard k = 50 000 kN/m³ en b leeg, zoals de 2D-staafdialoog: pas
 * met k én b groter dan nul wordt de bedding gezet, in één stap ongedaan te
 * maken. Een (bijna) verticale staaf krijgt alleen de zijdelingse k (paal);
 * staat daar toch nog een verticale k (een model van vóór de keuring bij het
 * verplaatsen, #106), dan blijft het k-veld zichtbaar zodat die te wissen is.
 * Rekent niets: de uitleg noemt de karakteristieke lengte, de kern rekent.
 */
export function OpenFem3DBeddingField({ model, beamIds, onChange }: {
  model: OpenFem3DModel;
  beamIds: readonly number[];
  onChange: (model: OpenFem3DModel) => void;
}) {
  const { t } = useTranslation("ribbon");
  const chosen = model.beams.filter((beam) => beamIds.includes(beam.id));
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const withBedding = chosen.filter((beam) => beam.bedding);
  const allOn = chosen.length > 0 && withBedding.length === chosen.length;
  const someOn = withBedding.length > 0 && !allOn;
  const current = withBedding[0]?.bedding;
  const different = withBedding.some((beam) => JSON.stringify(beam.bedding) !== JSON.stringify(current));
  const allVertical = chosen.length > 0 && chosen.every((beam) => openFem3DBeamIsColumn(beam, nodes));
  const allSteep = chosen.length > 0 && chosen.every((beam) => openFem3DBeddingAllRound(beam, nodes));
  // Een aangevinkte bedding die nog niet compleet is (b nog leeg): alleen hier.
  const [concept, setConcept] = useState<Concept | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectie = chosen.map((beam) => beam.id).join(",");
  useEffect(() => { setConcept(null); setError(null); }, [selectie]);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (box.current) box.current.indeterminate = someOn && concept === null; }, [someOn, concept]);
  if (chosen.length === 0) return null;

  const shown: Concept | null = concept ?? (current ? { ...current, compressionOnly: current.compressionOnly === true } : null);
  const ids = chosen.map((beam) => beam.id);
  const pasToe = (next: Concept) => {
    const bedding = compleet(next);
    if (!bedding) { setConcept(next); setError(null); return; }
    try {
      onChange(setOpenFem3DBeamBedding(model, ids, bedding));
      setConcept(null);
      setError(null);
    } catch (fout) {
      setConcept(next);
      setError(fout instanceof Error ? fout.message : String(fout));
    }
  };
  const zet = (aan: boolean) => {
    if (!aan) {
      setConcept(null);
      setError(null);
      onChange(setOpenFem3DBeamBedding(model, ids, null));
      return;
    }
    const begin: Concept = current
      ? { ...current, compressionOnly: current.compressionOnly === true }
      : allVertical
        ? { kLateralKnPerM3: OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3, compressionOnly: false }
        : { kKnPerM3: OPEN_FEM_3D_BEDDING_DEFAULT_K_KN_PER_M3, compressionOnly: false };
    pasToe(begin);
  };
  const aan = allOn || concept !== null;
  const onvolledig = concept !== null && compleet(concept) === null;
  // Een verticale staaf met nog een verticale k: toon k (en alleen druk) om ze te kunnen wissen.
  const verticalWithK = allVertical && shown?.kKnPerM3 !== undefined;
  const toonK = !allVertical || verticalWithK;

  return <section className="fem-prop-section" data-open-fem3d-bedding-section>
    <div className="fem-prop-section-title">{t("openFem3d.bedding.title")}</div>
    <label className="open-fem3d-check-row">
      <input ref={box} type="checkbox" data-open-fem3d-bedding checked={aan}
        onChange={(event) => zet(event.target.checked)} />
      <span>{chosen.length === 1 ? t("openFem3d.bedding.toggle") : t("openFem3d.bedding.toggleMulti", { count: chosen.length })}</span>
    </label>
    {aan && shown && <>
      {toonK && <div className="fem-prop-row" title={t("openFem3d.bedding.modulusTitle")}>
        <span className="fem-prop-label">{t("openFem3d.bedding.modulus")}</span>
        <span className="fem-prop-value"><GetalVeld data-open-fem3d-bedding-k value={shown.kKnPerM3}
          optional={shown.kLateralKnPerM3 !== undefined || verticalWithK} aria-label={t("openFem3d.bedding.modulusTitle")}
          onCommit={(k) => pasToe({ ...shown, kKnPerM3: k })} /></span>
      </div>}
      <div className="fem-prop-row" title={t("openFem3d.bedding.widthTitle")}>
        <span className="fem-prop-label">{t("openFem3d.bedding.width")}</span>
        {/* Invoer in mm (issue #36); het 3D-model bewaart meters. */}
        <span className="fem-prop-value"><LengthInput className="fem-prop-input" storedUnit="m" positive
          data-open-fem3d-bedding-width="" aria-label={t("openFem3d.bedding.widthTitle")}
          placeholder={t("openFem3d.bedding.widthPlaceholder")} value={shown.widthM ?? null}
          onChange={(meters) => { if (meters !== undefined) pasToe({ ...shown, widthM: meters }); }} /></span>
      </div>
      <div className="fem-prop-row" title={t("openFem3d.bedding.lateralTitle")}>
        <span className="fem-prop-label">{t("openFem3d.bedding.lateral")}</span>
        <span className="fem-prop-value"><GetalVeld data-open-fem3d-bedding-lateral value={shown.kLateralKnPerM3}
          optional={shown.kKnPerM3 !== undefined} placeholder={t("openFem3d.bedding.lateralPlaceholder")}
          aria-label={t("openFem3d.bedding.lateralTitle")}
          onCommit={(k) => pasToe({ ...shown, kLateralKnPerM3: k })} /></span>
      </div>
      {toonK && <label className="open-fem3d-check-row">
        <input type="checkbox" data-open-fem3d-bedding-compression checked={shown.compressionOnly}
          disabled={shown.kKnPerM3 === undefined}
          onChange={(event) => pasToe({ ...shown, compressionOnly: event.target.checked })} />
        <span>{t("openFem3d.bedding.compressionOnly")}</span>
      </label>}
      {different && concept === null && <p className="fem-prop-hint">{t("openFem3d.bedding.mixed")}</p>}
      {allVertical && <p className="fem-prop-hint" data-open-fem3d-bedding-vertical>{t("openFem3d.bedding.verticalHint")}</p>}
      {verticalWithK && <p className="open-fem3d-error" role="alert" data-open-fem3d-bedding-vertical-k>{t("openFem3d.bedding.verticalHasK")}</p>}
      {allSteep && !allVertical && shown.kLateralKnPerM3 !== undefined
        && <p className="fem-prop-hint" data-open-fem3d-bedding-all-round>{t("openFem3d.bedding.allRoundHint")}</p>}
    </>}
    {onvolledig && <p className="fem-prop-hint" data-open-fem3d-bedding-incomplete>{t("openFem3d.bedding.incomplete")}</p>}
    {error && <p className="open-fem3d-error" role="alert" data-open-fem3d-bedding-error>{error}</p>}
    <p className="fem-prop-hint">{t("openFem3d.bedding.hint")}</p>
    {aan && toonK && <p className="fem-prop-hint">{t("openFem3d.bedding.compressionHint")}</p>}
  </section>;
}

/** De uitkomst van de bedding bij één staaf (tab Resultaten); niets zonder bedding. */
export function OpenFem3DBeddingResults({ model, beamId, result }: {
  model: OpenFem3DModel;
  beamId: number;
  result: OpenFem3DSolveResult;
}) {
  const { t } = useTranslation("ribbon");
  const row = openFem3DBeddingSummary({ beams: model.beams.filter((beam) => beam.id === beamId) }, result)[0];
  if (!row) return null;
  const getal = (waarde: number, cijfers = 2) => Number.isFinite(waarde) ? waarde.toFixed(cijfers) : "—";
  return <section className="fem-prop-section" data-open-fem3d-bedding-results={beamId}>
    <div className="fem-prop-section-title">{t("openFem3d.bedding.resultsTitle")}</div>
    {!row.result ? <p className="fem-prop-hint">{t("openFem3d.bedding.noResult")}</p> : <>
      <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.bedding.maxSettlement")}</span>
        <span className="fem-prop-value"><code>{getal(row.result.maxSettlementMm, 3)} mm</code></span></div>
      <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.bedding.maxPressure")}</span>
        <span className="fem-prop-value"><code>{getal(row.result.maxPressureKnPerM)} kN/m · {getal(row.result.maxPressureKnPerM2)} kN/m²</code></span></div>
      {row.compressionOnly && <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.bedding.lifted")}</span>
        <span className="fem-prop-value"><code>{getal(row.result.liftedPercent, 1)} %</code></span></div>}
      <div className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.bedding.totalReaction")}</span>
        <span className="fem-prop-value"><code>{getal(row.result.totalReactionKn)} kN</code></span></div>
    </>}
  </section>;
}
