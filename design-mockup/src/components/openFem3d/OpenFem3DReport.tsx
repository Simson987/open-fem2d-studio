import { isOpenFem3DGlobalMemberLoad, openFem3DSupportPresetOf, type OpenFem3DModel } from "./openFem3dModel";
import { analyseOpenFem3DLoadPanels } from "./openFem3dLoadPanels";
import { openFem3DWindPressureReport } from "./openFem3dWindPressureReport";
import { drukmethodeLabel } from "../../lib/wind/windEurocode";
import { toonMm } from "../../lib/lengthInput";
import type { OpenFem3DDiagrams, OpenFem3DSolveResult } from "./openFem3dSolver";
import {
  checkUc,
  openFem3DGoverningUlsCheck,
  openFem3DUlsUc,
  type OpenFem3DSteelChecks,
} from "./openFem3dSteelCheck";
import type { OpenFem3DConcreteChecks } from "./openFem3dConcreteCheck";
import { openFem3DTimberGoverningUlsCheck, openFem3DTimberUlsUc, type OpenFem3DTimberChecks } from "./openFem3dTimberCheck";
import type { LoadCombination } from "../fem/solver/combinations";
import { useTranslation } from "react-i18next";
import OpenFem3DReportViews, { OpenFem3DViewFiguur } from "./OpenFem3DReportViews";
import { openFem3DMaximumDisplacementM } from "./openFem3dDisplacement";
import { openFem3DRapportViews } from "./openFem3dStandaardViews";
import { openFem3DRapportBeeld, rapportGetal } from "./openFem3dRapportBeeld";
import { buildOpenFem3DUtilizations } from "./openFem3dUtilization";
import { openFem3DMeldingen } from "./openFem3dMeldingen";
import { openFem3DHorizontaleVerplaatsingen, openFem3DUcPerGroep } from "./openFem3dRapportSamenvatting";
import { openFem3DDoorlopendeOmhullenden, openFem3DRapportOmhullenden, type OmhullendeGroep, type OmhullendeSoort } from "./openFem3dRapportOmhullenden";
import { openFem3DStabilityRow, openFem3DTensionOnlySummary } from "./openFem3dTrekSchijf";
import type { OpenFem3DStandaardViewId, OpenFem3DViewSet } from "./openFem3dViewSets";
import { formatOpenFem3DPlateValue, openFem3DPlateExtremes } from "./openFem3dPlateResults";
import { openFem3DPlateEdges } from "./openFem3dPlateEdges";
import { openFem3DBeddingSummary } from "./openFem3dBedding";
import { openFem3DPlateBeddingSummary } from "./openFem3dPlateBedding";
import "./OpenFem3DReport.css";
import { openFem3DProfielTekst } from "./openFem3dVerloop";
import { VerloopBlok } from "../report/sections/CheckDetailSection";
import { CONCRETE_E_CM, NU_BETON } from "../../lib/sectionResolver";
import { resolveOpenFem3DAnalysisMaterial } from "./openFem3dAnalysisMaterial";
import { openFem3DExplodedModel } from "./openFem3dExplode";
import type { OpenFem3DLevel } from "./openFem3dLevels";
import { DEFAULT_OPEN_FEM_3D_SECTION_BOX } from "./openFem3dSectionBox";

interface OpenFem3DReportProps {
  model: OpenFem3DModel;
  levels?: readonly OpenFem3DLevel[];
  result: OpenFem3DSolveResult | null;
  checks?: OpenFem3DSteelChecks | null;
  concreteChecks?: OpenFem3DConcreteChecks | null;
  timberChecks?: OpenFem3DTimberChecks | null;
  checksRunning?: boolean;
  checksError?: string | null;
  projectName?: string;
  activeLoadCaseId?: number;
  activeLoadCaseName?: string;
  /** Gevuld wanneer het getoonde resultaat een volledige combinatie is. */
  activeCombinationName?: string;
  activeCombinationFactors?: ReadonlyMap<number, number>;
  combinations?: readonly LoadCombination[];
  combinationResults?: ReadonlyMap<number, OpenFem3DSolveResult>;
  /** Tab Views: resultaten per belastinggeval, de actieve combinatie en de rapportkeuzes. */
  caseResults?: ReadonlyMap<number, OpenFem3DSolveResult>;
  activeCombinationId?: number | null;
  viewSets?: readonly OpenFem3DViewSet[];
  standaardViewsUitRapport?: readonly OpenFem3DStandaardViewId[];
  /**
   * De afleiding van de initiële scheefstand (φ, h, m, α_h, α_m), één regel per
   * zin. Leeg = er is zonder scheefstand gerekend; dan zwijgt het rapport erover.
   */
  scheefstandTekst?: string;
}

const number = (value: number, digits = 3) =>
  Number.isFinite(value) ? value.toLocaleString("nl-NL", { maximumFractionDigits: digits }) : "—";

const signed = (value: number, digits = 3) =>
  Number.isFinite(value) ? value.toLocaleString("nl-NL", { maximumFractionDigits: digits, signDisplay: "exceptZero" }) : "—";

function diagramMaximum(
  result: OpenFem3DSolveResult,
  key: keyof OpenFem3DDiagrams,
  memberId: number,
  fallback: number,
) {
  return result.diagrams?.[key].find((diagram) => diagram.memberId === memberId)?.maxAbsValue ?? fallback;
}


/** Compact, printable report for the current spatial frame calculation. */
export default function OpenFem3DReport({
  model, levels = [], result, checks, concreteChecks, timberChecks, checksRunning, checksError, projectName,
  activeLoadCaseId = 1, activeLoadCaseName, activeCombinationName, activeCombinationFactors,
  combinations = [], combinationResults,
  caseResults, activeCombinationId = null, viewSets = [], standaardViewsUitRapport = [],
  scheefstandTekst = "",
}: OpenFem3DReportProps) {
  const { t } = useTranslation("ribbon");
  const concreteMaterials = [...new Set([
    ...model.beams.map((beam) => beam.material?.trim()),
    ...(model.plates ?? []).map((plate) => plate.material?.trim()),
  ])].filter((material): material is string => !!material && Object.prototype.hasOwnProperty.call(CONCRETE_E_CM, material));
  // De aangevinkte views uit de tab Views, elk als afbeelding met titel.
  const utilizations = buildOpenFem3DUtilizations(checks, concreteChecks, timberChecks);
  // Voor een groot model: de horizontale verplaatsing (BGT) tegen h/300 en de
  // unity checks per staafgroep en profiel.
  const horizontaal = combinationResults ? openFem3DHorizontaleVerplaatsingen(model, combinations, combinationResults) : [];
  const omhullenden = combinationResults ? openFem3DRapportOmhullenden(combinations, combinationResults) : [];
  const doorlopendeRijen = openFem3DDoorlopendeOmhullenden(model, omhullenden);
  const ucPerGroep = checks ? openFem3DUcPerGroep(model, checks.results) : [];
  const rapportViews = openFem3DRapportViews({
    model, viewSets, standaardUitRapport: standaardViewsUitRapport, result, caseResults, combinationResults,
    combinations, activeLoadCaseId, activeCombinationId, heeftToetsing: utilizations.length > 0,
  });
  const toestand = (combinationId: number | null, loadCaseId: number) => combinationId !== null
    ? combinations.find((combination) => combination.id === combinationId)?.name ?? t("openFem3dVisibility.combinationN", { ns: "common", id: combinationId })
    : loadCaseId === activeLoadCaseId && activeLoadCaseName ? activeLoadCaseName : t("openFem3d.report.caseN", { id: loadCaseId });
  const omhullendePunt = (punt: { waarde: number; combinatieId: number; combinatie: string; positieM?: number }) =>
    `${signed(punt.waarde)}${punt.positieM === undefined ? "" : ` · x=${number(punt.positieM, 2)} m`}`;
  const omhullendeSecties = (["uls", "sls"] as const).flatMap((soort: OmhullendeSoort) =>
    (["staaf", "reactie", "verplaatsing"] as const).flatMap((groep: OmhullendeGroep) => {
      const rijen = omhullenden.filter((rij) => rij.soort === soort && rij.groep === groep);
      if (rijen.length === 0) return [];
      return [<div key={`${soort}-${groep}`} className="open-fem3d-report-envelope-table">
        <h3>{t(`openFem3d.report.envelopeGroup.${groep}`)} · {t(soort === "uls" ? "openFem3d.report.uls" : "openFem3d.report.sls")}</h3>
        <table className="open-fem3d-report-wide"><thead><tr>
          <th>{t(groep === "staaf" ? "openFem3d.report.member" : "openFem3d.report.node")}</th>
          <th>{t("openFem3d.report.quantity")}</th><th>{t("openFem3d.report.envelopeMin")}</th>
          <th>{t("openFem3d.report.envelopeCombination")}</th><th>{t("openFem3d.report.envelopeMax")}</th>
          <th>{t("openFem3d.report.envelopeCombination")}</th>
        </tr></thead><tbody>
          {rijen.map((rij) => <tr key={`${rij.id}-${rij.grootheid}`}>
            <td>{rij.id}</td><td>{rij.grootheid} [{rij.eenheid}]</td>
            <td>{omhullendePunt(rij.min)}</td><td>#{rij.min.combinatieId} {rij.min.combinatie}</td>
            <td>{omhullendePunt(rij.max)}</td><td>#{rij.max.combinatieId} {rij.max.combinatie}</td>
          </tr>)}
        </tbody></table>
      </div>];
    }));
  const viewsSectie = rapportViews.length > 0 ? <section data-open-fem3d-rapport-views>
    <h2>{t("openFem3dViews.rapportTitel", { ns: "common" })}</h2>
    <div className="open-fem3d-report-viewset">
      {rapportViews.map((view) => {
        const beeld = view.reden ? null : openFem3DRapportBeeld({
          model: openFem3DExplodedModel(model, levels, view.lagen.explode),
          lagen: view.lagen.explode.amountM > 0
            ? { ...view.lagen, sectionBox: DEFAULT_OPEN_FEM_3D_SECTION_BOX } : view.lagen,
          view: view.view, camera: view.camera, resultaat: view.resultaat,
          utilizations, loadCaseId: view.loadCaseId,
        });
        const metResultaat = view.resultaat !== null || view.lagen.loads;
        return <OpenFem3DViewFiguur key={view.sleutel} sleutel={view.sleutel} beeld={beeld}
          titel={view.standaard ? t(`openFem3dViews.titel.${view.standaard}`, { ns: "common" }) : view.naam ?? ""}
          ondertitel={metResultaat ? toestand(view.combinationId, view.loadCaseId) : undefined}
          reden={view.reden ? t(view.reden, { ns: "common" }) : undefined}
          vergrotingTekst={beeld?.vergroting ? t("openFem3dViews.vergroting", { ns: "common", n: rapportGetal(beeld.vergroting, 1) }) : undefined} />;
      })}
    </div>
  </section> : null;
  const maxDisplacement = result ? openFem3DMaximumDisplacementM(model, result) : 0;
  const firstMode = result?.buckling.status === "available" ? result.buckling.modes[0] : undefined;
  const equilibrium = result?.equilibrium;
  const tensionOnly = result ? openFem3DTensionOnlySummary(model, result) : null;
  const stability = result ? openFem3DStabilityRow(model, result) : null;
  const factor = (caseId: number) => activeCombinationFactors
    ? activeCombinationFactors.get(caseId) ?? 0
    : caseId === activeLoadCaseId ? 1 : 0;
  const nodalLoads = (model.loads ?? []).flatMap((load) => {
    const loadFactor = factor(load.caseId ?? 1);
    return loadFactor === 0 ? [] : [{
      ...load, loadFactor,
      fx: load.fx * loadFactor, fy: load.fy * loadFactor, fz: load.fz * loadFactor,
      mx: load.mx * loadFactor, my: load.my * loadFactor, mz: load.mz * loadFactor,
    }];
  });
  // Eén regel per richting: lokaal y of z (een last met qy én qz geeft twee
  // regels), of globaal X/Y/Z, per staafmeter of per projectie (issue #80).
  const memberLoads = (model.memberLoads ?? []).flatMap((load) => {
    const loadFactor = factor(load.caseId ?? 1);
    if (loadFactor === 0) return [];
    const row = (key: string, direction: string, qStart: number, qEnd: number) => ({
      key, id: load.id, caseId: load.caseId ?? 1, loadFactor, beamId: load.beamId, direction,
      qStart: qStart * loadFactor, qEnd: qEnd * loadFactor, startPositionM: load.startPositionM, endPositionM: load.endPositionM,
    });
    if (isOpenFem3DGlobalMemberLoad(load)) {
      return [row(String(load.id), t(load.perProjection ? "openFem3d.report.directionGlobalProjection" : "openFem3d.report.directionGlobal",
        { axis: load.globalDirection.toUpperCase() }), load.qStart, load.qEnd)];
    }
    return [
      ...(load.qyStart !== 0 || load.qyEnd !== 0 ? [row(`${load.id}-y`, t("openFem3d.report.directionLocal", { axis: "y" }), load.qyStart, load.qyEnd)] : []),
      ...(load.qzStart !== 0 || load.qzEnd !== 0 ? [row(`${load.id}-z`, t("openFem3d.report.directionLocal", { axis: "z" }), load.qzStart, load.qzEnd)] : []),
    ];
  });
  const memberPointLoads = (model.memberPointLoads ?? []).flatMap((load) => {
    const loadFactor = factor(load.caseId ?? 1);
    return loadFactor === 0 ? [] : [{
      ...load, loadFactor, py: load.py * loadFactor, pz: load.pz * loadFactor,
    }];
  });
  const thermalLoads = (model.thermalLoads ?? []).flatMap((load) => {
    const loadFactor = factor(load.caseId ?? 1);
    return loadFactor === 0 ? [] : [{
      ...load, loadFactor,
      deltaTUniformK: load.deltaTUniformK * loadFactor,
      deltaTGradientYK: load.deltaTGradientYK * loadFactor,
      deltaTGradientZK: load.deltaTGradientZK * loadFactor,
    }];
  });
  const surfaceLoads = (model.surfaceLoads ?? []).flatMap((load) => {
    const loadFactor = factor(load.caseId ?? 1);
    return loadFactor === 0 ? [] : [{
      ...load, loadFactor,
      qx: load.qx * loadFactor, qy: load.qy * loadFactor, qz: load.qz * loadFactor,
    }];
  });
  // Belastingvlakken van de getoonde toestand, met de afdracht zoals die naar
  // de kern is gegaan (dezelfde functie als de rekenadapter).
  const loadPanelAnalyses = analyseOpenFem3DLoadPanels(model).flatMap((analysis) => {
    const loadFactor = factor(analysis.panel.caseId ?? 1);
    return loadFactor === 0 ? [] : [{ ...analysis, loadFactor }];
  });
  const windPressureReport = openFem3DWindPressureReport(loadPanelAnalyses.map(({ panel }) => panel));
  const loadPanelSection = loadPanelAnalyses.length > 0 && <>
    <h3>{t("openFem3d.report.loadPanels")}</h3>
    <table className="open-fem3d-report-wide"><thead><tr>
      <th>ID</th><th>{t("openFem3d.report.case")}</th><th>{t("openFem3d.report.factor")}</th><th>{t("openFem3d.report.contourNodes")}</th>
      <th>q (kN/m²)</th><th>{t("openFem3d.report.loadDirection")}</th><th>{t("openFem3d.report.distribution")}</th>
      <th>A (m²)</th><th>A<sub>proj</sub> (m²)</th><th>{t("openFem3d.report.resultant")}</th>
    </tr></thead><tbody>
      {loadPanelAnalyses.map(({ panel, result, loadFactor }) => <tr key={panel.id}>
        <td>{panel.id}</td><td>{panel.caseId ?? 1}</td><td>{number(loadFactor, 3)}</td><td>{panel.nodeIds.join(" · ")}</td>
        <td>{signed(panel.q)}</td>
        <td>{t(`openFem3d.loadPanel.${panel.direction}`)}</td>
        <td>{t(panel.distribution === "oneWay" ? "openFem3d.loadPanel.oneWay" : "openFem3d.loadPanel.twoWay")}
          {panel.distribution === "oneWay" && panel.spanDirection
            ? ` (${number(panel.spanDirection.x)}; ${number(panel.spanDirection.y)}; ${number(panel.spanDirection.z)})` : ""}</td>
        <td>{result ? number(result.geometry.areaM2) : "—"}</td>
        <td>{result ? number(result.geometry.projectedAreaM2) : "—"}</td>
        <td>{result ? result.totalForceKn.map((value) => signed(value * loadFactor)).join(" / ") : "—"}</td>
      </tr>)}
    </tbody></table>
    {loadPanelAnalyses.some(({ panel }) => panel.generated?.source === "envelope3d") && <>
      <h3>{t("openFem3d.report.generatedEnvelope", "Gegenereerde schillasten — afleiding")}</h3>
      <table className="open-fem3d-report-wide"><thead><tr>
        <th>ID</th><th>{t("openFem3d.report.case")}</th><th>{t("openFem3d.report.panel")}</th>
        <th>Zone</th><th>c<sub>pe</sub> / C<sub>p</sub> / μ</th><th>c<sub>pi</sub></th><th>c<sub>s</sub>·c<sub>d</sub></th><th>q<sub>ref</sub> (kN/m²)</th>
        <th>q (kN/m²)</th><th>{t("openFem3d.report.resultant")}</th><th>Normbron</th>
      </tr></thead><tbody>
        {loadPanelAnalyses.filter(({ panel }) => panel.generated?.source === "envelope3d")
          .map(({ panel, result, loadFactor }) => <tr key={`generated-${panel.id}`}>
            <td>{panel.id}</td><td>{panel.caseId}</td><td>{panel.generated!.panelId}</td>
            <td>{panel.generated!.zone}</td><td>{number(panel.generated!.coefficient)}</td>
            <td>{panel.generated!.internalPressureCoefficient === undefined
              ? "—" : number(panel.generated!.internalPressureCoefficient)}</td>
            <td>{panel.generated!.windStructuralFactor === undefined
              ? "—" : number(panel.generated!.windStructuralFactor)}</td>
            <td>{number(panel.generated!.referencePressureKnPerM2)}</td><td>{signed(panel.q)}</td>
            <td>{result ? result.totalForceKn.map((value) => signed(value * loadFactor)).join(" / ") : "—"}</td>
            <td>{panel.generated!.sourceReference}</td>
          </tr>)}
      </tbody></table>
      {loadPanelAnalyses.some(({ panel }) => panel.generated?.windPressurePlan?.basis.kind === "separate-pressures") && <>
        <h4>NBC 2025 · {t("openFem3d.report.windPressureDerivation", "Winddruk — drukbalans")}</h4>
        <table className="open-fem3d-report-wide"><thead><tr>
          <th>ID</th><th>p<sub>e</sub> (kN/m²)</th><th>p<sub>i</sub> (kN/m²)</th>
          <th>p<sub>net</sub> (kN/m²)</th><th>Normbron</th>
        </tr></thead><tbody>
          {loadPanelAnalyses.flatMap(({ panel }) => {
            const plan = panel.generated?.windPressurePlan;
            if (plan?.basis.kind !== "separate-pressures") return [];
            return [<tr key={`wind-balance-${panel.id}`}>
              <td>{panel.id}</td><td>{signed(plan.basis.externalPressureKnPerM2)}</td>
              <td>{signed(plan.basis.internalPressureKnPerM2)}</td>
              <td>{signed(plan.pressure.inwardKnPerM2)}</td><td>{plan.source}</td>
            </tr>];
          })}
        </tbody></table>
      </>}
    </>}
    {windPressureReport.sources.length > 0 && <>
      <h3>{t("openFem3d.report.windPressureDerivation", "Winddruk — afleiding van de referentiedruk")}</h3>
      {windPressureReport.sources.map((source, index) => <div key={`wind-pressure-${index}`}>
        <h4>{source.windCodeId} · {source.pressureMethod === "nbc-static" ? <>h<sub>e</sub></> : <>z<sub>e</sub></>} = {number(source.referenceHeightM, 2)} m ·
          {source.pressureMethod === "nbc-static" ? <>q</> : <>q<sub>p</sub></>} = {number(source.pressureKnPerM2, 4)} kN/m² ·
          {t(`report.windPressureMethod.${source.pressureMethod ?? "unknown"}`,
            source.pressureMethod === "nbc-static" ? "NBC 2025 static" : drukmethodeLabel(source.pressureMethod))} ·
          {t("openFem3d.report.windPressurePanelCount", { n: source.loadPanelIds.length,
            defaultValue: "{{n}} belastingvlakken" })}</h4>
        <table className="open-fem3d-report-wide"><thead><tr>
          <th>{t("openFem3d.report.symbol", "Symbool")}</th>
          <th>{t("openFem3d.report.value", "Waarde")}</th>
          <th>{t("openFem3d.report.source", "Bron")}</th>
        </tr></thead><tbody>
          {source.derivation.map((line, lineIndex) => <tr key={`${index}-${lineIndex}`}>
            <td>{line.symbool}</td><td>{line.waarde}</td><td>{line.bron}</td>
          </tr>)}
        </tbody></table>
      </div>)}
    </>}
    {windPressureReport.missingPanelIds.length > 0 && <p>
      {t("openFem3d.report.windPressureDerivationMissing", {
        n: windPressureReport.missingPanelIds.length,
        defaultValue: "Bij {{n}} oudere windvlakken ontbreekt de drukafleiding; genereer de windlasten opnieuw.",
      })}
    </p>}
    {windPressureReport.internalSources.length > 0 && <>
      <h3>{t("openFem3d.report.internalPressureDerivation")}</h3>
      {windPressureReport.internalSources.map((source, index) => <div key={`internal-pressure-${index}`}>
        <h4>{source.windCodeId} · c<sub>pi</sub> = {number(source.coefficient, 4)} ·
          {t("openFem3d.report.windPressurePanelCount", { n: source.loadPanelIds.length })}</h4>
        <table className="open-fem3d-report-wide"><thead><tr>
          <th>{t("openFem3d.report.symbol")}</th>
          <th>{t("openFem3d.report.value")}</th>
          <th>{t("openFem3d.report.source")}</th>
        </tr></thead><tbody>
          {source.derivation.map((line, lineIndex) => <tr key={`${index}-${lineIndex}`}>
            <td>{line.symbool}</td><td>{line.waarde}</td><td>{line.bron}</td>
          </tr>)}
        </tbody></table>
      </div>)}
    </>}
    {windPressureReport.missingInternalPanelIds.length > 0 && <p>
      {t("openFem3d.report.internalPressureDerivationMissing", {
        n: windPressureReport.missingInternalPanelIds.length,
      })}
    </p>}
    <h3>{t("openFem3d.report.loadPanelDerived")}</h3>
    <table className="open-fem3d-report-wide"><thead><tr>
      <th>{t("openFem3d.report.panel")}</th><th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.report.rangeMm")}</th><th>{t("openFem3d.report.pStartEnd")}</th>
    </tr></thead><tbody>
      {loadPanelAnalyses.flatMap(({ panel, result, loadFactor }) => {
        if (!result) return [];
        const perWidth = (result.panel.direction === "gravity" ? Math.abs(result.geometry.normal[2]) : 1) * panel.q * loadFactor;
        return [
          ...result.beamLoads.flatMap((beamLoad) => beamLoad.pieces.map((piece, index) =>
            <tr key={`${panel.id}-${beamLoad.beamId}-${index}`}>
              <td>{panel.id}</td><td>{beamLoad.beamId}</td>
              <td>{toonMm(piece.startPositionM, "m")}–{toonMm(piece.endPositionM, "m")}</td>
              <td>{signed(piece.widthStartM * perWidth)} → {signed(piece.widthEndM * perWidth)}</td>
            </tr>)),
          ...result.pointShares.map((share, index) => <tr key={`${panel.id}-point-${index}`}>
            <td>{panel.id}</td>
            <td>{share.nodeId !== undefined
              ? t("openFem3d.report.loadPanelNodeShare", { node: share.nodeId })
              : t("openFem3d.report.loadPanelBeamShare", { beam: share.beamId, position: toonMm(share.positionM ?? 0, "m") })}</td>
            <td>—</td><td>{signed(share.areaM2 * perWidth)} kN</td>
          </tr>),
        ];
      })}
    </tbody></table>
    {loadPanelAnalyses.flatMap(({ panel, result, error }) => error
      ? [<p key={`error-${panel.id}`} className="open-fem3d-report-bad">{error}</p>]
      : (result?.warnings ?? []).map((message) => <p key={`${panel.id}-${message}`} className="open-fem3d-report-note">{message}</p>))}
    <p className="open-fem3d-report-note">{t("openFem3d.report.loadPanelNote")}</p>
  </>;

  // Staven op bedding (#106): de invoer en, met een uitkomst, wat de kern
  // ervan maakte. p/b is de gronddruk onder de contactbreedte.
  const beddingRows = openFem3DBeddingSummary(model, result);
  const beddingLateral = beddingRows.some((row) => row.kLateralKnPerM3 !== null);
  const beddingSection = beddingRows.length > 0 && <section data-open-fem3d-report-bedding>
    <h2>{t("openFem3d.report.beddingTitle")}</h2>
    <table className="open-fem3d-report-wide open-fem3d-report-bedding"><thead><tr>
      <th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.report.beddingK")}</th><th>{t("openFem3d.report.beddingWidth")}</th>
      {beddingLateral && <th>{t("openFem3d.report.beddingLateral")}</th>}
      <th>{t("openFem3d.report.beddingCompressionOnly")}</th>
      <th>{t("openFem3d.report.beddingSettlement")}</th><th>{t("openFem3d.report.beddingPressure")}</th>
      <th>{t("openFem3d.report.beddingStress")}</th><th>{t("openFem3d.report.beddingLifted")}</th>
      <th>{t("openFem3d.report.beddingReaction")}</th>
      {beddingLateral && <th>{t("openFem3d.report.beddingLateralMax")}</th>}
    </tr></thead><tbody>
      {beddingRows.map((row) => <tr key={row.beamId} data-open-fem3d-report-bedding-row={row.beamId}>
        <td>{row.beamId}</td><td>{row.kKnPerM3 === null ? "—" : number(row.kKnPerM3, 0)}</td><td>{number(row.widthMm, 0)}</td>
        {beddingLateral && <td>{row.kLateralKnPerM3 === null ? "—" : number(row.kLateralKnPerM3, 0)}</td>}
        <td>{t(row.compressionOnly ? "openFem3d.report.beddingYes" : "openFem3d.report.beddingNo")}</td>
        <td>{row.result ? number(row.result.maxSettlementMm, 2) : "—"}</td>
        <td>{row.result ? number(row.result.maxPressureKnPerM, 2) : "—"}</td>
        <td>{row.result ? number(row.result.maxPressureKnPerM2, 1) : "—"}</td>
        <td>{row.result ? `${number(row.result.liftedPercent, 1)} %` : "—"}</td>
        <td>{row.result ? number(row.result.totalReactionKn, 2) : "—"}</td>
        {beddingLateral && <td>{row.result?.maxLateralKnPerM == null ? "—" : number(row.result.maxLateralKnPerM, 2)}</td>}
      </tr>)}
    </tbody></table>
    {result && beddingRows.some((row) => row.result === null) && <p className="open-fem3d-report-bad">{t("openFem3d.bedding.noResult")}</p>}
    <p className="open-fem3d-report-note">{t("openFem3d.report.beddingNote")}</p>
  </section>;

  // Platen op bedding (#107): per plaat k, alleen druk en, met een uitkomst,
  // de grootste zakking, de grootste en kleinste gronddruk, het deel zonder
  // contact en de som van de grondveren.
  const plateBeddingRows = openFem3DPlateBeddingSummary(model, result);
  const plateBeddingSection = plateBeddingRows.length > 0 && <section data-open-fem3d-report-plate-bedding>
    <h2>{t("openFem3d.report.plateBeddingTitle")}</h2>
    <table className="open-fem3d-report-wide open-fem3d-report-bedding"><thead><tr>
      <th>{t("openFem3d.report.plate")}</th><th>{t("openFem3d.report.beddingK")}</th>
      <th>{t("openFem3d.report.beddingCompressionOnly")}</th>
      <th>{t("openFem3d.report.plateBeddingSettlement")}</th><th>{t("openFem3d.report.plateBeddingPressureMax")}</th>
      <th>{t("openFem3d.report.plateBeddingPressureMin")}</th><th>{t("openFem3d.report.beddingLifted")}</th>
      <th>{t("openFem3d.report.beddingReaction")}</th>
    </tr></thead><tbody>
      {plateBeddingRows.map((row) => <tr key={row.plateId} data-open-fem3d-report-plate-bedding-row={row.plateId}>
        <td>{row.plateId}</td><td>{number(row.kKnPerM3, 0)}</td>
        <td>{t(row.compressionOnly ? "openFem3d.report.beddingYes" : "openFem3d.report.beddingNo")}</td>
        <td>{row.result ? number(row.result.maxSettlementMm, 2) : "—"}</td>
        <td>{row.result ? number(row.result.maxPressureKnPerM2, 1) : "—"}</td>
        <td>{row.result ? number(row.result.minPressureKnPerM2, 1) : "—"}</td>
        <td>{row.result ? `${number(row.result.liftedPercent, 1)} %` : "—"}</td>
        <td>{row.result ? number(row.result.totalReactionKn, 2) : "—"}</td>
      </tr>)}
    </tbody></table>
    {result && plateBeddingRows.some((row) => row.result === null) && <p className="open-fem3d-report-bad">{t("openFem3d.plateBedding.noResult")}</p>}
    <p className="open-fem3d-report-note">{t("openFem3d.report.plateBeddingNote")}</p>
  </section>;

  return (
    <div className="open-fem3d-report-shell" data-open-fem3d-report={result ? "calculated" : "pending"}>
      <div className="open-fem3d-report-toolbar">
        <strong>{t("openFem3d.report.title")}</strong>
        <button type="button" onClick={() => window.print()}>{t("openFem3d.report.print")}</button>
      </div>
      <article className="open-fem3d-report-page">
        <header>
          <div>
            <p className="open-fem3d-report-kicker">Open FEM Studio</p>
            <h1>{t("openFem3d.report.heading")}</h1>
            <p>{projectName?.trim() || t("openFem3d.report.untitled")}</p>
          </div>
          <dl>
            <div><dt>{t("openFem3d.report.date")}</dt><dd>{new Date().toLocaleDateString("nl-NL")}</dd></div>
            <div><dt>{t("openFem3d.report.model")}</dt><dd>{t("openFem3d.modelCounts", { nodes: model.nodes.length, beams: model.beams.length, plates: model.plates?.length ?? 0 })}</dd></div>
          </dl>
        </header>

        {!result ? <>
          <section className="open-fem3d-report-empty">
            <h2>{t("openFem3d.noCalculation")}</h2>
            <p>{t("openFem3d.report.pendingHint")}</p>
          </section>
          {viewsSectie}
          {beddingSection}
          {plateBeddingSection}
          {loadPanelSection && <section>{loadPanelSection}</section>}
          {(model.plates?.length ?? 0) > 0 && <section>
            <h2>{t("openFem3d.report.platesAndOpenings")}</h2>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>{t("openFem3d.report.plate")}</th><th>{t("openFem3d.report.contourNodes")}</th><th>{t("openFem3d.report.edge")}</th><th>{t("openFem3d.report.thickness")}</th><th>{t("openFem3d.report.edgeRadius")}</th><th>{t("openFem3d.material")}</th><th>{t("openFem3d.report.openings")}</th>
            </tr></thead><tbody>
              {(model.plates ?? []).map((plate) => <tr key={plate.id}>
                <td>{plate.id}</td><td>{plate.nodeIds.join(" · ")}</td><td>{plate.boundary ? t("openFem3d.report.boundarySegments", { n: plate.boundary.length, arcs: plate.boundary.filter((segment) => segment.kind === "arc").length }) : t("openFem3d.report.cornerPoints")}</td><td>{number(plate.thicknessM)} m</td>
                <td>{number(plate.cornerRadiusM ?? 0)} m</td><td>{plate.material || "—"}</td>
                <td>{(plate.openings ?? []).length === 0 ? "—" : (plate.openings ?? []).map((opening) =>
                  `#${opening.id}: ${opening.nodeIds.join(" · ")} (r=${number(opening.cornerRadiusM ?? 0)} m)`).join("; ")}</td>
              </tr>)}
            </tbody></table>
            {(model.surfaceLoads?.length ?? 0) > 0 && <>
              <h3>{t("openFem3d.report.surfaceLoads")}</h3>
              <table className="open-fem3d-report-wide"><thead><tr>
                <th>ID</th><th>{t("openFem3d.report.case")}</th><th>{t("openFem3d.report.plate")}</th><th>qx</th><th>qy</th><th>qz</th>
              </tr></thead><tbody>
                {(model.surfaceLoads ?? []).map((load) => <tr key={load.id}>
                  <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{load.plateId}</td>
                  <td>{signed(load.qx)}</td><td>{signed(load.qy)}</td><td>{signed(load.qz)}</td>
                </tr>)}
              </tbody></table>
              <p className="open-fem3d-report-note">{t("openFem3d.report.surfaceNote")}</p>
            </>}
          </section>}
        </> : <>
          <section>
            <h2>{t("openFem3d.report.summary")}</h2>
            <div className="open-fem3d-report-cards">
              <div><span>{t("openFem3d.analysis")}</span><strong>{result.analysis === "p-delta" ? t("openFem3d.report.secondOrder") : t("openFem3d.report.firstOrder")}</strong></div>
              <div><span>{t("openFem3d.report.state")}</span><strong>{activeCombinationName || activeLoadCaseName || t("openFem3d.report.caseN", { id: activeLoadCaseId })}</strong></div>
              <div><span>{t("openFem3d.maxDisplacement")}</span><strong>{number(maxDisplacement * 1000)} mm</strong></div>
              <div><span>{t("openFem3d.report.convergence")}</span><strong>{result.secondOrder ? t("openFem3d.report.iterations", { count: result.secondOrder.iterations }) : t("openFem3d.report.direct")}</strong></div>
              <div><span>{t("openFem3d.report.firstBucklingFactor")}</span><strong
                className={result.analysis === "linear" && stability?.firstOrderSufficient === false ? "open-fem3d-report-bad" : undefined}>
                {firstMode ? number(firstMode.loadFactor) : t("openFem3d.check.notApplicable")}</strong></div>
              {tensionOnly && <div data-open-fem3d-report-tension-only><span>{t("openFem3d.report.tensionOnlyInactive")}</span><strong>{t("openFem3d.report.tensionOnlyValue", { inactive: tensionOnly.inactive, total: tensionOnly.total })}</strong></div>}
              <div><span>{t("openFem3d.equilibrium")}</span><strong className={equilibrium?.equilibriumOk === true && result.forceBalance?.ok !== false ? "open-fem3d-report-good" : "open-fem3d-report-bad"}>{equilibrium?.equilibriumOk === true && result.forceBalance?.ok !== false ? t("openFem3d.report.agreed") : equilibrium?.equilibriumOk === false || result.forceBalance?.ok === false ? t("openFem3d.report.deviation") : t("openFem3d.report.notVerified")}</strong></div>
              {result.forceBalance && <div><span>{t("openFem3d.report.forceSum")}</span><strong className={result.forceBalance.maxImbalanceKn <= result.forceBalance.toleranceKn ? "open-fem3d-report-good" : "open-fem3d-report-bad"}>{result.forceBalance.maxImbalanceKn <= result.forceBalance.toleranceKn ? t("openFem3d.report.agreed") : t("openFem3d.report.forceDeviation", { value: number(result.forceBalance.maxImbalanceKn, 4) })}</strong></div>}
              {result.forceBalance && <div><span>{t("openFem3d.report.momentSum")}</span><strong className={result.forceBalance.maxMomentImbalanceKnm <= result.forceBalance.momentToleranceKnm ? "open-fem3d-report-good" : "open-fem3d-report-bad"}>{result.forceBalance.maxMomentImbalanceKnm === undefined ? t("openFem3d.report.notVerified") : result.forceBalance.maxMomentImbalanceKnm <= result.forceBalance.momentToleranceKnm ? t("openFem3d.report.agreed") : t("openFem3d.report.momentDeviation", { value: number(result.forceBalance.maxMomentImbalanceKnm, 4) })}</strong></div>}
              <div><span>{t("openFem3d.report.maxAmplification")}</span><strong>{result.secondOrder ? number(result.secondOrder.maxAmplification) : "1,000"}</strong></div>
            </div>
          </section>

          {viewsSectie}
          {beddingSection}
          {plateBeddingSection}
          {(result.plates?.length ?? 0) > 0 && <section data-open-fem3d-report-plates>
            <h2>{t("openFem3d.report.platesResults")}</h2>
            <p className="open-fem3d-report-note">{t("openFem3d.report.platesResultsNote")}</p>
            {(result.plates ?? []).map((summary) => {
              const plate = model.plates?.find((item) => item.id === summary.plateId);
              const meshInfo = result.plateMesh?.plates.find((item) => item.plateId === summary.plateId);
              return <div key={summary.plateId}>
                <h3>{t("openFem3d.report.plate")} {summary.plateId}{plate ? ` · ${number(plate.thicknessM * 1000, 0)} mm · ${plate.material ?? "—"}` : ""}
                  {meshInfo ? ` · ${t("openFem3d.report.mesh")}: ${t("openFem3d.props.plateMeshValue", {
                    count: meshInfo.elementCount, size: Math.round(meshInfo.meshSizeM * 1000),
                    method: t(meshInfo.method === "raster" ? "openFem3d.props.meshRaster" : "openFem3d.props.meshTriangles"),
                  })}` : ""}</h3>
                <table className="open-fem3d-report-wide"><thead><tr>
                  <th>{t("openFem3d.report.quantity")}</th><th>{t("openFem3d.props.resultMin")}</th><th>{t("openFem3d.props.resultMax")}</th><th />
                </tr></thead><tbody>
                  {openFem3DPlateExtremes(result, summary.plateId).map((item) => <tr key={item.definition.key}>
                    <td>{t(`openFem3dPlate.quantity.${item.definition.key}`, { ns: "common" })}</td>
                    <td>{formatOpenFem3DPlateValue(item.min)}</td>
                    <td>{formatOpenFem3DPlateValue(item.max)}</td>
                    <td>{item.definition.unit}</td>
                  </tr>)}
                </tbody></table>
              </div>;
            })}
          </section>}

          <section>
            <h2>{t("openFem3d.report.views")}</h2>
            <OpenFem3DReportViews model={model} result={result} checks={checks} concreteChecks={concreteChecks} timberChecks={timberChecks} />
          </section>

          {combinationResults && combinationResults.size > 0 && <section>
            <h2>{t("openFem3d.report.combinations")}</h2>
            <table className="open-fem3d-report-wide" data-open-fem3d-report-combinations><thead><tr>
              <th>ID</th><th>{t("openFem3d.report.combination")}</th><th>{t("openFem3d.report.type")}</th><th>Δmax [mm]</th><th>P-Δ</th><th>αcr</th>
              {tensionOnly && <th>{t("openFem3d.report.tensionOnlyInactive")}</th>}
            </tr></thead><tbody>
              {combinations.filter((combination) => combinationResults.has(combination.id)).map((combination) => {
                const combinationResult = combinationResults.get(combination.id)!;
                const displacement = openFem3DMaximumDisplacementM(model, combinationResult) * 1000;
                const row = openFem3DStabilityRow(model, combinationResult);
                return <tr key={combination.id}>
                  <td>{combination.id}</td><td>{combination.name}</td><td>{combination.type === "uls" ? t("openFem3d.report.uls") : t("openFem3d.report.sls")}</td>
                  <td>{number(displacement)}</td>
                  <td>{combinationResult.secondOrder?.converged === false ? t("openFem3d.report.notConverged") : t("openFem3d.report.iterShort", { n: combinationResult.secondOrder?.iterations ?? 0 })}</td>
                  <td className={combinationResult.analysis === "linear" && row.firstOrderSufficient === false ? "open-fem3d-report-bad" : undefined}>
                    {row.alphaCr === null ? "—" : number(row.alphaCr)}</td>
                  {tensionOnly && <td>{row.inactiveTensionOnly === null ? "—" : t("openFem3d.report.tensionOnlyValue", { inactive: row.inactiveTensionOnly, total: tensionOnly.total })}</td>}
                </tr>;
              })}
            </tbody></table>
            <p className="open-fem3d-report-note">{t("openFem3d.report.alphaCrNote")}</p>
            {tensionOnly && <p className="open-fem3d-report-note">{t("openFem3d.report.tensionOnlyNote")}</p>}
            {tensionOnly && model.tensionOnlyFitAfterPermanent && <p className="open-fem3d-report-note" data-open-fem3d-report-fit>{t("openFem3d.report.tensionOnlyFitNote")}</p>}
            {tensionOnly && model.tensionOnlyCrossRule && <p className="open-fem3d-report-note" data-open-fem3d-report-cross-rule>{t("openFem3d.report.crossRuleNote")}</p>}
          </section>}

          {omhullendeSecties.length > 0 && <section className="open-fem3d-report-envelope" data-open-fem3d-report-envelopes>
            <h2>{t("openFem3d.report.envelopeTitle")}</h2>
            <p className="open-fem3d-report-note">{t("openFem3d.report.envelopeNote")}</p>
            {omhullendeSecties}
            {doorlopendeRijen.length > 0 && <div data-open-fem3d-report-continuous>
              <h3>{t("openFem3d.report.continuousTitle")}</h3>
              <p className="open-fem3d-report-note">{t("openFem3d.report.continuousNote")}</p>
              <table className="open-fem3d-report-wide open-fem3d-report-envelope-table"><thead><tr>
                <th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.report.type")}</th>
                <th>{t("openFem3d.report.quantity")}</th><th>{t("openFem3d.report.envelopeMin")}</th>
                <th>{t("openFem3d.report.envelopeCombination")}</th><th>{t("openFem3d.report.envelopeMax")}</th>
                <th>{t("openFem3d.report.envelopeCombination")}</th>
              </tr></thead><tbody>
                {doorlopendeRijen.map((rij) => <tr key={`${rij.naam}-${rij.deelIds.join("-")}-${rij.soort}-${rij.grootheid}`}>
                  <td>{rij.naam} (#{rij.deelIds.join(" + #")}; {number(rij.lengteM, 2)} m)</td>
                  <td>{t(rij.soort === "uls" ? "openFem3d.report.uls" : "openFem3d.report.sls")}</td>
                  <td>{rij.grootheid} [{rij.eenheid}]</td>
                  <td>{omhullendePunt(rij.min)}</td><td>#{rij.min.combinatieId} {rij.min.combinatie}</td>
                  <td>{omhullendePunt(rij.max)}</td><td>#{rij.max.combinatieId} {rij.max.combinatie}</td>
                </tr>)}
              </tbody></table>
            </div>}
          </section>}

          {horizontaal.length > 0 && <section data-open-fem3d-horizontaal>
            <h2>{t("openFem3d.report.horizontalTitle")}</h2>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>{t("openFem3d.report.combination")}</th><th>{t("openFem3d.report.node")}</th>
              <th>u<sub>x</sub> [mm]</th><th>u<sub>y</sub> [mm]</th><th>u<sub>hor</sub> [mm]</th>
              <th>h [m]</th><th>h/300 [mm]</th><th>UC</th>
            </tr></thead><tbody>
              {horizontaal.map((rij) => <tr key={rij.combinationId}>
                <td>{rij.naam}</td><td>{rij.nodeNaam ? `${rij.nodeId} (${rij.nodeNaam})` : rij.nodeId}</td>
                <td>{signed(rij.uxMm, 1)}</td><td>{signed(rij.uyMm, 1)}</td><td>{number(rij.uHorMm, 1)}</td>
                <td>{number(rij.hoogteM, 2)}</td><td>{number(rij.grensMm, 1)}</td>
                <td className={rij.uc > 1 ? "open-fem3d-report-bad" : "open-fem3d-report-good"}>{number(rij.uc, 2)}</td>
              </tr>)}
            </tbody></table>
            <p className="open-fem3d-report-note">{t("openFem3d.report.horizontalNote")}</p>
          </section>}

          {ucPerGroep.length > 0 && <section data-open-fem3d-uc-per-groep>
            <h2>{t("openFem3d.report.ucGroupsTitle")}</h2>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>{t("openFem3d.report.group")}</th><th>{t("openFem3d.report.profile")}</th><th>n</th>
              <th>{t("openFem3d.report.ucUls")}</th><th>{t("openFem3d.report.governingMember")}</th>
              <th>{t("openFem3d.report.governingCheck")}</th><th>{t("openFem3d.report.ucDeflection")}</th>
            </tr></thead><tbody>
              {ucPerGroep.map((rij) => <tr key={`${rij.groep}-${rij.profiel}-${rij.staalsoort}`}>
                <td>{rij.groep}</td><td>{rij.profiel} {rij.staalsoort}</td><td>{rij.aantal}</td>
                {/* Niet (volledig) getoetste staven tellen niet mee en zijn nooit
                    maatgevend; hun aantal staat erbij (controle 2026-10, B7). */}
                <td className={rij.ucMax === null ? "open-fem3d-report-note" : rij.ucMax > 1 ? "open-fem3d-report-bad" : "open-fem3d-report-good"}
                  data-open-fem3d-niet-getoetst={rij.aantalNietGetoetst > 0 ? rij.aantalNietGetoetst : undefined}>
                  {rij.ucMax === null ? "—" : number(rij.ucMax, 2)}{rij.aantalOverschreden > 0 ? ` (${rij.aantalOverschreden} > 1)` : ""}
                  {rij.aantalNietGetoetst > 0 ? ` · ${rij.aantalNietGetoetst} ${t("openFem3d.check.notChecked")}` : ""}
                </td>
                <td>{rij.maatgevendeStaafNaam ? `${rij.maatgevendeStaaf} (${rij.maatgevendeStaafNaam})` : rij.maatgevendeStaaf}</td>
                <td>{rij.maatgevendeToets}</td>
                <td>{rij.doorbuigingUcMax === null ? "—" : number(rij.doorbuigingUcMax, 2)}</td>
              </tr>)}
            </tbody></table>
          </section>}

          <section>
            <h2>{t("openFem3d.report.boundaryAndLoads")}</h2>
            <h3>{t("openFem3d.report.membersAndAxes")}</h3>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.profile")}</th><th>{t("openFem3d.report.rotation")}</th><th>{t("openFem3d.report.beamTheory")}</th><th>{t("openFem3d.report.releasesStart")}</th><th>{t("openFem3d.report.releasesEnd")}</th>
            </tr></thead><tbody>
              {model.beams.map((beam) => {
                const begin = [beam.releases?.torsionStart && "T", beam.releases?.myStart && "My", beam.releases?.mzStart && "Mz"].filter(Boolean).join(", ") || "—";
                const eind = [beam.releases?.torsionEnd && "T", beam.releases?.myEnd && "My", beam.releases?.mzEnd && "Mz"].filter(Boolean).join(", ") || "—";
                return <tr key={beam.id}><td>{beam.id}</td><td>{beam.profileName ? openFem3DProfielTekst(beam, t) : "—"} · {beam.material ?? "—"}</td>
                  <td>{number((beam.rollAngleRad ?? 0) * 180 / Math.PI)}°</td>
                  <td>{beam.shearDeformation ? "Timoshenko" : "Euler–Bernoulli"}</td><td>{begin}</td><td>{eind}</td></tr>;
              })}
            </tbody></table>
            {(model.plates?.length ?? 0) > 0 && <>
              <h3>{t("openFem3d.report.platesAndOpenings")}</h3>
              <table className="open-fem3d-report-wide"><thead><tr>
                <th>{t("openFem3d.report.plate")}</th><th>{t("openFem3d.report.contourNodes")}</th><th>{t("openFem3d.report.edge")}</th><th>{t("openFem3d.report.thickness")}</th><th>{t("openFem3d.report.edgeRadius")}</th><th>{t("openFem3d.material")}</th><th>{t("openFem3d.report.openings")}</th>
              </tr></thead><tbody>
                {(model.plates ?? []).map((plate) => <tr key={plate.id}>
                  <td>{plate.id}</td><td>{plate.nodeIds.join(" · ")}</td><td>{plate.boundary ? t("openFem3d.report.boundarySegments", { n: plate.boundary.length, arcs: plate.boundary.filter((segment) => segment.kind === "arc").length }) : t("openFem3d.report.cornerPoints")}</td><td>{number(plate.thicknessM)} m</td>
                  <td>{number(plate.cornerRadiusM ?? 0)} m</td><td>{plate.material || "—"}</td>
                  <td>{(plate.openings ?? []).length === 0 ? "—" : (plate.openings ?? []).map((opening) =>
                    `#${opening.id}: ${opening.nodeIds.join(" · ")} (r=${number(opening.cornerRadiusM ?? 0)} m)`).join("; ")}</td>
                </tr>)}
              </tbody></table>
            </>}
            <h3>{t("openFem3d.report.supports")}</h3>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>{t("openFem3d.report.node")}</th><th>{t("openFem3d.report.type")}</th><th>{t("openFem3d.report.restrainedDofs")}</th><th>{t("openFem3d.report.springs")}</th><th>{t("openFem3d.report.prescribed")}</th><th>{t("openFem3d.report.freeRotationAxis")}</th>
            </tr></thead><tbody>
              {(model.supports ?? []).map((support) => {
                const kind = openFem3DSupportPresetOf(support);
                const restrained = [support.ux && "Ux", support.uy && "Uy", support.uz && "Uz", support.rx && "Rx", support.ry && "Ry", support.rz && "Rz"].filter(Boolean).join(", ");
                const springs = ([
                  ["Kx", support.springs?.kxKnPerM, "kN/m"], ["Ky", support.springs?.kyKnPerM, "kN/m"], ["Kz", support.springs?.kzKnPerM, "kN/m"],
                  ["Krx", support.springs?.krxKnmPerRad, "kNm/rad"], ["Kry", support.springs?.kryKnmPerRad, "kNm/rad"], ["Krz", support.springs?.krzKnmPerRad, "kNm/rad"],
                ] as const).flatMap(([label, stiffness, unit]) => stiffness === undefined ? [] : [`${label} ${number(stiffness)} ${unit}`]).join(" · ") || "—";
                const prescribed = ([
                  ["Ux", support.prescribed?.uxM, 1000, "mm"], ["Uy", support.prescribed?.uyM, 1000, "mm"], ["Uz", support.prescribed?.uzM, 1000, "mm"],
                  ["Rx", support.prescribed?.rxRad, 1000, "mrad"], ["Ry", support.prescribed?.ryRad, 1000, "mrad"], ["Rz", support.prescribed?.rzRad, 1000, "mrad"],
                ] as const).flatMap(([label, value, factor, unit]) => value === undefined ? [] : [`${label} ${signed(value * factor)} ${unit}`]).join(" · ") || "—";
                const freeAxis = kind === "revoluteX" ? "X" : kind === "revoluteY" ? "Y" : kind === "revoluteZ" ? "Z" : "—";
                return <tr key={support.nodeId}><td>{support.nodeId}</td><td>{t(`openFem3d.report.supportType.${kind}`)}</td><td>{restrained || "—"}</td><td>{springs}</td><td>{prescribed}</td><td>{freeAxis}</td></tr>;
              })}
            </tbody></table>
            {(model.plates ?? []).some((plate) => (plate.edgeSupports?.length ?? 0) > 0) && <>
              <h3>{t("openFem3d.report.edgeSupports")}</h3>
              <table className="open-fem3d-report-wide" data-open-fem3d-report-edge-supports><thead><tr>
                <th>{t("openFem3d.report.plate")}</th><th>{t("openFem3d.report.edge")}</th><th>{t("openFem3d.report.type")}</th><th>{t("openFem3d.report.restrainedDofs")}</th>
              </tr></thead><tbody>
                {(model.plates ?? []).flatMap((plate) => {
                  const edges = openFem3DPlateEdges(plate);
                  return (plate.edgeSupports ?? []).map((support) => {
                    const edge = edges[support.edge];
                    const restrained = [support.ux && "Ux", support.uy && "Uy", support.uz && "Uz", support.rx && "Rx", support.ry && "Ry", support.rz && "Rz"].filter(Boolean).join(", ");
                    return <tr key={`${plate.id}:${support.edge}`}>
                      <td>{plate.id}</td>
                      <td>{edge ? t(edge.controlNodeId === undefined ? "openFem3d.props.edgeLabel" : "openFem3d.props.edgeArcLabel",
                        { index: edge.index + 1, from: edge.startNodeId, to: edge.endNodeId }) : support.edge + 1}</td>
                      <td>{t(`openFem3d.report.supportType.${openFem3DSupportPresetOf(support)}`)}</td><td>{restrained}</td>
                    </tr>;
                  });
                })}
              </tbody></table>
              <p className="open-fem3d-report-note">{t("openFem3d.report.edgeSupportsNote")}</p>
            </>}
            <h3>{t("openFem3d.report.nodalLoads")}</h3>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>ID</th><th>{t("openFem3d.report.case")}</th><th>{t("openFem3d.report.factor")}</th><th>{t("openFem3d.report.node")}</th><th>Fx</th><th>Fy</th><th>Fz</th><th>Mx</th><th>My</th><th>Mz</th>
            </tr></thead><tbody>
              {nodalLoads.map((load) => <tr key={load.id}>
                <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td><td>{load.nodeId}</td><td>{signed(load.fx)}</td><td>{signed(load.fy)}</td><td>{signed(load.fz)}</td>
                <td>{signed(load.mx)}</td><td>{signed(load.my)}</td><td>{signed(load.mz)}</td>
              </tr>)}
            </tbody></table>
            <p className="open-fem3d-report-note">{t("openFem3d.report.nodalNote")}</p>
            {[...new Map(nodalLoads.filter((load) => load.generated?.source === "nbc2025-partial-wind")
              .map((load) => [load.caseId, load.generated!.sourceReference] as const))]
              .map(([caseId, source]) => <p key={`nbc-partial-${caseId}`} className="open-fem3d-report-note">
                {t("openFem3d.report.case")} {caseId}: {source}
              </p>)}
            {surfaceLoads.length > 0 && <>
              <h3>{t("openFem3d.report.surfaceLoads")}</h3>
              <table className="open-fem3d-report-wide"><thead><tr>
                <th>ID</th><th>{t("openFem3d.report.case")}</th><th>{t("openFem3d.report.factor")}</th><th>{t("openFem3d.report.plate")}</th><th>qx</th><th>qy</th><th>qz</th>
              </tr></thead><tbody>
                {surfaceLoads.map((load) => <tr key={load.id}>
                  <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td><td>{load.plateId}</td>
                  <td>{signed(load.qx)}</td><td>{signed(load.qy)}</td><td>{signed(load.qz)}</td>
                </tr>)}
              </tbody></table>
              <p className="open-fem3d-report-note">{t("openFem3d.report.surfaceNote")}</p>
            </>}
            <h3>{t("openFem3d.report.memberLoads")}</h3>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>ID</th><th>{t("openFem3d.report.case")}</th><th>{t("openFem3d.report.factor")}</th><th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.report.direction")}</th><th>{t("openFem3d.report.qStart")}</th><th>{t("openFem3d.report.qEnd")}</th><th>{t("openFem3d.report.range")}</th>
            </tr></thead><tbody>
              {memberLoads.map((load) => <tr key={load.key} data-open-fem3d-report-member-load={load.key}>
                <td>{load.id}</td><td>{load.caseId}</td><td>{number(load.loadFactor, 3)}</td><td>{load.beamId}</td>
                <td>{load.direction}</td><td>{signed(load.qStart)}</td><td>{signed(load.qEnd)}</td>
                <td>{number(load.startPositionM)}–{number(load.endPositionM)} m</td>
              </tr>)}
            </tbody></table>
            <p className="open-fem3d-report-note">{t("openFem3d.report.memberLoadNote")}</p>
            <h3>{t("openFem3d.report.memberPointLoads")}</h3>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>ID</th><th>{t("openFem3d.report.case")}</th><th>{t("openFem3d.report.factor")}</th><th>{t("openFem3d.report.member")}</th><th>Py</th><th>Pz</th><th>{t("openFem3d.report.position")}</th>
            </tr></thead><tbody>
              {memberPointLoads.map((load) => <tr key={load.id}>
                <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td><td>{load.beamId}</td>
                <td>{signed(load.py)}</td><td>{signed(load.pz)}</td><td>{number(load.positionM)} m</td>
              </tr>)}
            </tbody></table>
            <p className="open-fem3d-report-note">{t("openFem3d.report.pointLoadNote")}</p>
            <h3>{t("openFem3d.report.thermalLoads")}</h3>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>ID</th><th>{t("openFem3d.report.case")}</th><th>{t("openFem3d.report.factor")}</th><th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.report.deltaTUniform")}</th><th>{t("openFem3d.report.deltaTLocalY")}</th><th>{t("openFem3d.report.deltaTLocalZ")}</th>
            </tr></thead><tbody>
              {thermalLoads.map((load) => <tr key={load.id}>
                <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td><td>{load.beamId}</td>
                <td>{signed(load.deltaTUniformK)}</td><td>{signed(load.deltaTGradientYK)}</td><td>{signed(load.deltaTGradientZK)}</td>
              </tr>)}
            </tbody></table>
            <p className="open-fem3d-report-note">{t("openFem3d.report.thermalNote")}</p>
            {loadPanelSection}
          </section>

          <section>
            <h2>{t("openFem3d.report.method")}</h2>
            <table><tbody>
              <tr><th>{t("openFem3d.report.engine")}</th><td>{result.engine.name}</td></tr>
              <tr><th>{t("openFem3d.report.revision")}</th><td><code>{result.engine.revision.slice(0, 12)}</code></td></tr>
              <tr><th>{t("openFem3d.report.license")}</th><td>{result.engine.license}</td></tr>
              <tr><th>{t("openFem3d.report.secondOrderRow")}</th><td>{result.secondOrder ? `${result.secondOrder.converged ? t("openFem3d.report.converged") : t("openFem3d.report.notConverged")}; ${result.secondOrder.stable ? t("openFem3d.report.stable") : t("openFem3d.report.unstable")}` : t("openFem3d.report.notPerformed")}</td></tr>
              <tr><th>{t("openFem3d.report.relativeResidual")}</th><td>{equilibrium ? number(equilibrium.relativeResidual, 8) : t("openFem3d.report.notAvailable")}</td></tr>
              <tr><th>{t("openFem3d.report.maxImbalance")}</th><td>{equilibrium ? `${number(equilibrium.maxImbalanceKn, 8)} kN` : t("openFem3d.report.notAvailable")}</td></tr>
              {result.forceBalance && <tr><th>{t("openFem3d.report.independentForceSum")}</th><td>{t("openFem3d.report.forceSumValue", { values: result.forceBalance.imbalanceKn.map((value) => number(value, 5)).join(" / "), limit: number(result.forceBalance.toleranceKn, 5) })}</td></tr>}
              {result.forceBalance?.momentImbalanceKnm && <tr><th>{t("openFem3d.report.independentMomentSum")}</th><td>{t("openFem3d.report.momentSumValue", { values: result.forceBalance.momentImbalanceKnm.map((value) => number(value, 5)).join(" / "), limit: number(result.forceBalance.momentToleranceKnm, 5) })}</td></tr>}
            </tbody></table>
          </section>

          {concreteMaterials.length > 0 && <section data-open-fem3d-analysis-materials>
            <h2>{t("openFem3d.report.analysisMaterials")}</h2>
            <table><thead><tr><th>{t("openFem3d.material")}</th><th>{t("openFem3d.props.analysisEChoice")}</th>
              <th>Ecm (MPa)</th><th>E (MPa)</th><th>φ</th><th>ν</th></tr></thead><tbody>
              {concreteMaterials.map((material) => {
                const choice = model.analysisMaterials?.[material]?.concreteModulus;
                const resolved = resolveOpenFem3DAnalysisMaterial(material, CONCRETE_E_CM[material], NU_BETON, model);
                return <tr key={material}><td>{material}</td>
                  <td>{choice?.kind === "creep" ? t("openFem3d.props.analysisCreep")
                    : choice?.kind === "custom" ? t("openFem3d.props.analysisCustom") : "Ecm"}</td>
                  <td>{number(CONCRETE_E_CM[material], 2)}</td><td>{number(resolved.eMpa, 2)}</td>
                  <td>{choice?.kind === "creep" ? number(choice.phi, 3) : "—"}</td><td>{number(resolved.nu, 3)}</td>
                </tr>;
              })}
            </tbody></table>
          </section>}

          {scheefstandTekst && <section data-open-fem3d-scheefstand>
            <h2>{t("openFem3d.report.swayImperfection")}</h2>
            {scheefstandTekst.split("\n").map((regel, index) => <p key={index}>{regel}</p>)}
          </section>}

          <section>
            <h2>{t("openFem3d.report.bucklingAnalysis")}</h2>
            {result.buckling.status === "available" ? <>
              <table><thead><tr><th>{t("openFem3d.report.mode")}</th><th>{t("openFem3d.report.loadFactor")}</th></tr></thead><tbody>
                {result.buckling.modes.map((mode) => <tr key={mode.mode}><td>{mode.mode}</td><td>{number(mode.loadFactor, 5)}</td></tr>)}
              </tbody></table>
              <h3>{t("openFem3d.report.compressionMembers")}</h3>
              <table className="open-fem3d-report-wide"><thead><tr><th>{t("openFem3d.report.member")}</th><th>N (kN)</th><th>Ncr (kN)</th><th>Lcr (m)</th><th>λ</th></tr></thead><tbody>
                {result.buckling.members.map((member) => {
                  const principal = result.principalAxesMemberIds?.includes(member.memberId);
                  return <tr key={member.memberId}>
                    <td>{member.memberId}</td><td>{signed(member.axialForceKn)}</td><td>{number(member.criticalForceKn)}</td>
                    <td>{number(member.effectiveLengthM)}</td>
                    <td>λ{principal ? "u" : "y"} {number(member.slendernessY)} · λ{principal ? "v" : "z"} {number(member.slendernessZ)}</td>
                  </tr>;
                })}
              </tbody></table>
            </> : <p>{result.buckling.reason}</p>}
          </section>

          <section>
            <h2>{t("openFem3d.report.steelCheck")}</h2>
            {checksRunning && <p>{t("openFem3d.report.checksRunning")}</p>}
            {checksError && <p className="open-fem3d-report-bad">{t("openFem3d.report.checkError", { error: checksError })}</p>}
            {!checksRunning && !checksError && checks && checks.results.length > 0 && <>
              <table className="open-fem3d-report-wide"><thead><tr>
                <th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.profile")}</th><th>{t("openFem3d.report.steel")}</th><th>{t("openFem3d.check.class")}</th><th>{t("openFem3d.check.ucUls")}</th><th>{t("openFem3d.check.governing")}</th><th>{t("openFem3d.check.status")}</th>
              </tr></thead><tbody>
                {checks.results.map((check) => {
                  const uc = openFem3DUlsUc(check);
                  const governing = openFem3DGoverningUlsCheck(check);
                  // Status n.v.t.: niet (volledig) getoetst — geen UC en geen
                  // "voldoet", maar de reden van de kern (controle 2026-10, B7).
                  const nietGetoetst = check.status === "NotApplicable";
                  return <tr key={check.beam_id} data-open-fem3d-niet-getoetst={nietGetoetst ? check.beam_id : undefined}>
                    <td>{check.beam_id}</td><td>{check.profile_name}</td><td>{check.steel_grade}</td><td>{check.classification}</td>
                    <td>{nietGetoetst ? "—" : number(uc)}</td>
                    <td>{nietGetoetst ? check.governing_check_id : governing?.kind.data.title ?? "—"}</td>
                    <td className={nietGetoetst ? "open-fem3d-report-note" : uc <= 1 ? "open-fem3d-report-good" : "open-fem3d-report-bad"}>
                      {nietGetoetst ? t("openFem3d.check.notChecked") : uc <= 1 ? t("openFem3d.check.pass") : t("openFem3d.check.fail")}
                    </td>
                  </tr>;
                })}
              </tbody></table>
              {checks.notes.map((note) => <p key={note} className="open-fem3d-report-note">{note}</p>)}
              {/* Verlopend profiel (#73): de toetsdoorsneden per station, zoals in 2D. */}
              {checks.results.filter((check) => check.verloop).map((check) => <div key={`verloop-${check.beam_id}`}
                data-open-fem3d-verloop={check.beam_id}>
                <h3>{t("openFem3d.report.taperedMember", { id: check.beam_id, profile: check.profile_name })}</h3>
                <VerloopBlok verloop={check.verloop!} />
              </div>)}
            </>}
            {!checksRunning && !checksError && checks && checks.results.length === 0 && <p>{t("openFem3d.report.noSteel")}</p>}
            {checks && checks.skipped.length > 0 && <details>
              <summary>{t("openFem3d.report.skippedSteel", { count: checks.skipped.length })}</summary>
              <ul>{checks.skipped.map((item) => <li key={item.beamId}>{t("tree.barLabel", { ns: "common", id: item.beamId })}: {item.reason}</li>)}</ul>
            </details>}
          </section>

          <section>
            <h2>{t("openFem3d.report.concreteCheck")}</h2>
            {checksRunning && <p>{t("openFem3d.report.checksRunning")}</p>}
            {checksError && <p className="open-fem3d-report-bad">{t("openFem3d.report.checkError", { error: checksError })}</p>}
            {!checksRunning && !checksError && concreteChecks && concreteChecks.results.length > 0 && <>
              <table className="open-fem3d-report-wide"><thead><tr>
                <th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.check.section")}</th><th>{t("openFem3d.report.concrete")}</th><th>{t("openFem3d.check.reinforcement")}</th><th>{t("openFem3d.check.ucUls")}</th><th>{t("openFem3d.check.governing")}</th><th>{t("openFem3d.check.status")}</th>
              </tr></thead><tbody>
                {concreteChecks.results.map((check) => {
                  const governing = check.checks.find((item) => item.id === check.governing_check_id);
                  const incompleteOutsideDetailing = check.niet_uitgevoerd.some((item) => !item.detaillering);
                  return <tr key={check.beam_id}>
                    <td>{check.beam_id}</td><td>{check.section_name}</td><td>{check.concrete_class}</td><td>{check.reinforcement_summary}</td>
                    <td>{number(check.uc_max)}</td><td>{governing?.kind.data.title ?? check.governing_check_id}</td>
                    <td className={check.status === "NotOk" ? "open-fem3d-report-bad" : incompleteOutsideDetailing || check.status === "NotApplicable" ? "open-fem3d-report-note" : "open-fem3d-report-good"}>
                      {check.status === "NotOk" ? t("openFem3d.check.fail") : incompleteOutsideDetailing || check.status === "NotApplicable" ? t("openFem3d.report.ulsPassOthersOpen") : t("openFem3d.check.pass")}
                    </td>
                  </tr>;
                })}
              </tbody></table>
              <h3>{t("openFem3d.report.governingSubchecks")}</h3>
              <table className="open-fem3d-report-wide open-fem3d-report-checks"><thead><tr>
                <th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.report.checkName")}</th><th>{t("openFem3d.check.article")}</th><th>UC</th><th>{t("openFem3d.check.status")}</th>
              </tr></thead><tbody>
                {concreteChecks.results.flatMap((beamCheck) => {
                  const withUc = beamCheck.checks
                    .filter((check) => checkUc(check) !== null)
                    .sort((a, b) => (checkUc(b) ?? 0) - (checkUc(a) ?? 0));
                  const governing = withUc.find((check) => check.id === beamCheck.governing_check_id);
                  const selected = [
                    ...(governing ? [governing] : []),
                    ...withUc.filter((check) => check.id !== governing?.id),
                  ].slice(0, 6);
                  return selected.map((check) => <tr key={`${beamCheck.beam_id}-${check.id}`}>
                    <td>{beamCheck.beam_id}</td>
                    <td>{check.kind.data.title}</td>
                    <td>{check.kind.data.article}</td>
                    <td>{number(checkUc(check) ?? 0)}</td>
                    <td className={check.kind.data.status === "Ok" ? "open-fem3d-report-good" : check.kind.data.status === "NotOk" ? "open-fem3d-report-bad" : "open-fem3d-report-note"}>
                      {check.kind.data.status === "Ok" ? t("openFem3d.check.pass") : check.kind.data.status === "NotOk" ? t("openFem3d.check.fail") : t("openFem3d.check.notApplicable")}
                    </td>
                  </tr>);
                })}
              </tbody></table>
              {concreteChecks.notes.map((note) => <p key={note} className="open-fem3d-report-note">{note}</p>)}
              {concreteChecks.results.some((check) => check.niet_uitgevoerd.length > 0) && <details>
                <summary>{t("openFem3d.report.notPerformedConcrete")}</summary>
                <ul>{concreteChecks.results.flatMap((check) => check.niet_uitgevoerd.map((item, index) => {
                  const detail = check.checks.find((candidate) => candidate.id === item.check_id);
                  return <li key={`${check.beam_id}-${index}`}>{t("tree.barLabel", { ns: "common", id: check.beam_id })}: {item.titel}{detail?.kind.data.notes.length ? ` — ${detail.kind.data.notes.join(" ")}` : ""}</li>;
                }))}</ul>
              </details>}
            </>}
            {!checksRunning && !checksError && concreteChecks && concreteChecks.results.length === 0 && <p>{t("openFem3d.report.noConcrete")}</p>}
            {concreteChecks && concreteChecks.skipped.length > 0 && <details>
              <summary>{t("openFem3d.report.skippedConcrete", { count: concreteChecks.skipped.length })}</summary>
              <ul>{concreteChecks.skipped.map((item) => <li key={item.beamId}>{t("tree.barLabel", { ns: "common", id: item.beamId })}: {item.reason}</li>)}</ul>
            </details>}
          </section>

          <section>
            <h2>{t("openFem3d.report.timberCheck")}</h2>
            {checksRunning && <p>{t("openFem3d.report.checksRunning")}</p>}
            {checksError && <p className="open-fem3d-report-bad">{t("openFem3d.report.checkError", { error: checksError })}</p>}
            {!checksRunning && !checksError && timberChecks && timberChecks.results.length > 0 && <>
              <table className="open-fem3d-report-wide"><thead><tr>
                <th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.check.section")}</th><th>{t("openFem3d.report.timber")}</th>
                <th>{t("openFem3d.check.ucUls")}</th><th>{t("openFem3d.check.governing")}</th><th>{t("openFem3d.check.status")}</th>
              </tr></thead><tbody>
                {timberChecks.results.map((check) => {
                  const uc = openFem3DTimberUlsUc(check);
                  const governing = openFem3DTimberGoverningUlsCheck(check);
                  const hasUls = governing !== undefined;
                  return <tr key={check.beam_id}>
                    <td>{check.beam_id}</td><td>{check.section_name}</td><td>{check.strength_class}</td>
                    <td>{hasUls ? number(uc) : "—"}</td><td>{governing?.kind.data.title ?? "—"}</td>
                    <td className={hasUls ? uc > 1 ? "open-fem3d-report-bad" : "open-fem3d-report-good" : "open-fem3d-report-note"}>{hasUls ? uc > 1 ? t("openFem3d.check.fail") : t("openFem3d.check.pass") : t("openFem3d.check.notApplicable")}</td>
                  </tr>;
                })}
              </tbody></table>
              <h3>{t("openFem3d.report.timberSubchecks")}</h3>
              <table className="open-fem3d-report-wide open-fem3d-report-checks"><thead><tr>
                <th>{t("openFem3d.report.member")}</th><th>{t("openFem3d.report.checkName")}</th><th>{t("openFem3d.check.article")}</th><th>UC</th><th>{t("openFem3d.check.status")}</th>
              </tr></thead><tbody>
                {timberChecks.results.flatMap((beamCheck) => beamCheck.checks.map((check) => <tr key={`${beamCheck.beam_id}-${check.id}`}>
                  <td>{beamCheck.beam_id}</td><td>{check.kind.data.title}</td><td>{check.kind.data.article}</td>
                  <td>{checkUc(check) === null ? "—" : number(checkUc(check) ?? 0)}</td>
                  <td className={check.kind.data.status === "NotOk" ? "open-fem3d-report-bad" : check.kind.data.status === "Ok" ? "open-fem3d-report-good" : "open-fem3d-report-note"}>
                    {check.kind.data.status === "NotOk" ? t("openFem3d.check.fail") : check.kind.data.status === "Ok" ? t("openFem3d.check.pass") : t("openFem3d.check.notApplicable")}
                  </td>
                </tr>))}
              </tbody></table>
              {timberChecks.notes.map((note) => <p key={note} className="open-fem3d-report-note">{note}</p>)}
            </>}
            {!checksRunning && !checksError && timberChecks && timberChecks.results.length === 0 && <p>{t("openFem3d.report.noTimber")}</p>}
            {timberChecks && timberChecks.skipped.length > 0 && <details>
              <summary>{t("openFem3d.report.skippedTimber", { count: timberChecks.skipped.length })}</summary>
              <ul>{timberChecks.skipped.map((item) => <li key={item.beamId}>{t("tree.barLabel", { ns: "common", id: item.beamId })}: {item.reason}</li>)}</ul>
            </details>}
          </section>

          <section>
            <h2>{t("openFem3d.report.memberForces")}</h2>
            <table className="open-fem3d-report-wide"><thead><tr>
              <th>{t("openFem3d.report.member")}</th><th>L (m)</th><th>|N|max (kN)</th><th>|Vy|max (kN)</th><th>|Vz|max (kN)</th><th>|T|max (kNm)</th><th>|My|max (kNm)</th><th>|Mz|max (kNm)</th>
            </tr></thead><tbody>
              {result.memberForces.map((member) => <tr key={member.memberId}>
                <td>{member.memberId}</td><td>{number(member.lengthM)}</td>
                <td>{number(diagramMaximum(result, "axial", member.memberId, Math.max(Math.abs(member.nStartKn), Math.abs(member.nEndKn))))}</td>
                <td>{number(diagramMaximum(result, "shearY", member.memberId, Math.max(Math.abs(member.vyStartKn), Math.abs(member.vyEndKn))))}</td>
                <td>{number(diagramMaximum(result, "shearZ", member.memberId, Math.max(Math.abs(member.vzStartKn), Math.abs(member.vzEndKn))))}</td>
                <td>{number(diagramMaximum(result, "torsion", member.memberId, Math.max(Math.abs(member.torsionStartKnm), Math.abs(member.torsionEndKnm))))}</td>
                <td>{number(diagramMaximum(result, "momentY", member.memberId, Math.max(Math.abs(member.myStartKnm), Math.abs(member.myEndKnm))))}</td>
                <td>{number(diagramMaximum(result, "momentZ", member.memberId, Math.max(Math.abs(member.mzStartKnm), Math.abs(member.mzEndKnm))))}</td>
              </tr>)}
            </tbody></table>
          </section>

          <section>
            <h2>{t("openFem3d.report.reactions")}</h2>
            <table className="open-fem3d-report-wide"><thead><tr><th>{t("openFem3d.report.node")}</th><th>Fx</th><th>Fy</th><th>Fz</th><th>Mx</th><th>My</th><th>Mz</th></tr></thead><tbody>
              {result.reactions.map((reaction) => <tr key={reaction.nodeId}>
                <td>{reaction.nodeId}</td><td>{signed(reaction.fx)}</td><td>{signed(reaction.fy)}</td><td>{signed(reaction.fz)}</td>
                <td>{signed(reaction.mx)}</td><td>{signed(reaction.my)}</td><td>{signed(reaction.mz)}</td>
              </tr>)}
            </tbody></table>
            <p className="open-fem3d-report-note">{t("openFem3d.report.reactionsNote")}</p>
          </section>

          {(() => {
            // Onterechte meldingen van de kern (Y in plaats van Z omhoog, #61) vallen weg.
            const meldingen = openFem3DMeldingen(result.diagnostics, model);
            if (meldingen.kern.length + meldingen.bijnaVerticaal.length === 0) return null;
            return <section>
              <h2>{t("openFem3d.report.diagnostics")}</h2>
              <ul>
                {meldingen.bijnaVerticaal.map(({ beamId, cos }) => <li key={`bijna-verticaal-${beamId}`}>
                  {t("openFem3d.report.nearlyVertical", { id: beamId, cos: cos.toFixed(4) })}
                </li>)}
                {meldingen.kern.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
              </ul>
            </section>;
          })()}
        </>}
      </article>
    </div>
  );
}
