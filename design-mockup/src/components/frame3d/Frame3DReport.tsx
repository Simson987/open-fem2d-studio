import { frame3DSupportPresetOf, type Frame3DModel } from "./frame3dModel";
import type { Frame3DDiagrams, Frame3DSolveResult } from "./frame3dSolver";
import {
  checkUc,
  frame3DGoverningUlsCheck,
  frame3DUlsUc,
  type Frame3DSteelChecks,
} from "./frame3dSteelCheck";
import type { Frame3DConcreteChecks } from "./frame3dConcreteCheck";
import type { LoadCombination } from "../fem/solver/combinations";
import Frame3DReportViews from "./Frame3DReportViews";
import { frame3DMaximumDisplacementM } from "./frame3dDisplacement";
import "./Frame3DReport.css";

interface Frame3DReportProps {
  model: Frame3DModel;
  result: Frame3DSolveResult | null;
  checks?: Frame3DSteelChecks | null;
  concreteChecks?: Frame3DConcreteChecks | null;
  checksRunning?: boolean;
  checksError?: string | null;
  projectName?: string;
  activeLoadCaseId?: number;
  activeLoadCaseName?: string;
  /** Gevuld wanneer het getoonde resultaat een volledige combinatie is. */
  activeCombinationName?: string;
  activeCombinationFactors?: ReadonlyMap<number, number>;
  combinations?: readonly LoadCombination[];
  combinationResults?: ReadonlyMap<number, Frame3DSolveResult>;
}

const number = (value: number, digits = 3) =>
  Number.isFinite(value) ? value.toLocaleString("nl-NL", { maximumFractionDigits: digits }) : "—";

const signed = (value: number, digits = 3) =>
  Number.isFinite(value) ? value.toLocaleString("nl-NL", { maximumFractionDigits: digits, signDisplay: "exceptZero" }) : "—";

const reinforcementCaseLabel = (value: string) => ({
  "both-directions": "x en y",
  "x-only": "alleen x",
  "y-only": "alleen y",
  "compression-only": "alleen druk",
}[value] ?? value);

function diagramMaximum(
  result: Frame3DSolveResult,
  key: keyof Frame3DDiagrams,
  memberId: number,
  fallback: number,
) {
  return result.diagrams?.[key].find((diagram) => diagram.memberId === memberId)?.maxAbsValue ?? fallback;
}

const SUPPORT_LABELS = {
  fixed: "Inklemming",
  pinned: "Ruimtelijk scharnier",
  xRoller: "X-rol",
  yRoller: "Y-rol",
  zRoller: "Z-rol",
  revoluteX: "Revolute X",
  revoluteY: "Revolute Y",
  revoluteZ: "Revolute Z",
  custom: "Vrij ingesteld",
} as const;

/** Compact, printable report for the current spatial frame calculation. */
export default function Frame3DReport({
  model, result, checks, concreteChecks, checksRunning, checksError, projectName,
  activeLoadCaseId = 1, activeLoadCaseName, activeCombinationName, activeCombinationFactors,
  combinations = [], combinationResults,
}: Frame3DReportProps) {
  const maxDisplacement = result ? frame3DMaximumDisplacementM(model, result) : 0;
  const volumeResultById = new Map(result?.volume3D?.elements.map((element) => [element.elementId, element]) ?? []);
  const plateInput = result?.plateBending
    ? model.plates?.find((plate) => plate.id === result.plateBending?.plateId) : undefined;
  const plateReinforcement = plateInput?.reinforcement;
  const plateNonlinearLaw = plateInput?.nonlinearLaw;
  const firstMode = result?.buckling.status === "available" ? result.buckling.modes[0] : undefined;
  const equilibrium = result?.equilibrium;
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
  const memberLoads = (model.memberLoads ?? []).flatMap((load) => {
    const loadFactor = factor(load.caseId ?? 1);
    return loadFactor === 0 ? [] : [{
      ...load, loadFactor,
      qyStart: load.qyStart * loadFactor, qyEnd: load.qyEnd * loadFactor,
      qzStart: load.qzStart * loadFactor, qzEnd: load.qzEnd * loadFactor,
    }];
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
  const plateEdgeLoads = (model.plateEdgeLoads ?? []).flatMap((load) => {
    const loadFactor = factor(load.caseId ?? 1);
    return loadFactor === 0 ? [] : [{ ...load, loadFactor,
      startKnPerM: load.startKnPerM * loadFactor, endKnPerM: load.endKnPerM * loadFactor }];
  });
  const dktPlates = result?.volume3D?.bendingPlates ?? [];
  const dktTriangleCount = dktPlates.reduce((sum, plate) => sum + (plate.centroidMoments?.length ?? 0), 0);
  const dktVisibleTriangles: Array<{ plateId: number; triangleIndex: number;
    nodeIds: [number, number, number]; momentKnmPerM: [number, number, number] }> = [];
  for (const plate of dktPlates) {
    for (const triangle of plate.centroidMoments ?? []) {
      if (dktVisibleTriangles.length === 250) break;
      dktVisibleTriangles.push({ plateId: plate.plateId, ...triangle });
    }
    if (dktVisibleTriangles.length === 250) break;
  }

  return (
    <div className="frame3d-report-shell" data-frame3d-report={result ? "calculated" : "pending"}>
      <div className="frame3d-report-toolbar">
        <strong>3D rekenrapport</strong>
        <button type="button" onClick={() => window.print()}>Afdrukken / PDF</button>
      </div>
      <article className="frame3d-report-page">
        <header>
          <div>
            <p className="frame3d-report-kicker">Open FEM Studio</p>
            <h1>{result?.plateBending ? "3D-plaatberekening"
              : result?.volume3D?.bendingPlates?.length ? "3D-volume- en plaatberekening"
                : result?.volume3D ? "3D-volume- en raamwerkberekening" : "3D raamwerkberekening"}</h1>
            <p>{projectName?.trim() || "Naamloos project"}</p>
          </div>
          <dl>
            <div><dt>Datum</dt><dd>{new Date().toLocaleDateString("nl-NL")}</dd></div>
            <div><dt>Model</dt><dd>{model.nodes.length} knopen · {model.beams.length} staven · {model.plates?.length ?? 0} platen · {model.volumes?.length ?? 0} volumes</dd></div>
          </dl>
        </header>

        {(model.volumes?.length ?? 0) > 0 && <section>
          <h2>Volume-elementen</h2>
          {result?.volume3D && <p className="frame3d-report-note">
            {result.volume3D.formulation === "totalLagrangian"
              ? `Totale-Lagrange Tet4-GNL met W = W₀ + βW₀²/(2E₀) (β=0: St Venant–Kirchhoff); Newton-tangent: ${result.volume3D.backendUsed}; ${result.volume3D.newtonIterations ?? 0} iteraties; ${result.volume3D.acceptedSteps ?? 0} geaccepteerde stappen; ${result.volume3D.cutbacks ?? 0} terugstappen. Getoonde spanningen zijn Cauchy-spanningen in de eindgeometrie.`
              : result.volume3D.formulation === "totalLagrangianJ2"
                ? `Totale-Lagrange Tet4/Hex8-GNL met J2-staalplastificatie; Newton-tangent: ${result.volume3D.backendUsed}; ${result.volume3D.newtonIterations ?? 0} iteraties; ${result.volume3D.acceptedSteps ?? 0} geaccepteerde stappen; ${result.volume3D.cutbacks ?? 0} terugstappen. Getoonde spanningen zijn Cauchy-spanningen in de eindgeometrie, berekend uit de eerste Piola-spanning; voor Hex8 het gemiddelde van acht Gauss-punten. Lasten zijn vast in de referentieconfiguratie.`
              : result.volume3D.formulation === "smallStrainMaterial"
                ? `Tet4-materiaal-FNL bij kleine rek; Newton-tangent: ${result.volume3D.backendUsed}; ${result.volume3D.newtonIterations ?? 0} iteraties; ${result.volume3D.acceptedSteps ?? 0} geaccepteerde stappen; ${result.volume3D.cutbacks ?? 0} terugstappen. Plastische rek of betontrekschade wordt per element bewaard.`
              : `Lineaire oplosser: ${result.volume3D.backendUsed}; ${result.volume3D.linearIterations} iteraties; relatief residu ${result.volume3D.relativeResidual.toExponential(3)}. Spanningen zijn lineair en klein-vervormd.`}
          </p>}
          <table className="frame3d-report-wide"><thead><tr>
            <th>ID</th><th>Type</th><th>Knoop-ID's</th><th>E [MPa]</th><th>ν</th><th>ρ [kg/m³]</th>
            {result?.volume3D?.formulation === "totalLagrangian" && <><th>β</th><th>Eeff [MPa]</th></>}
            {result?.volume3D && <><th>σxx [MPa]</th><th>σyy [MPa]</th><th>σzz [MPa]</th><th>τxy [MPa]</th><th>τyz [MPa]</th><th>τzx [MPa]</th><th>von Mises [MPa]</th></>}
            {(result?.volume3D?.formulation === "smallStrainMaterial" || result?.volume3D?.formulation === "totalLagrangianJ2")
              && <><th>εp,eq</th><th>Trekschade</th></>}
          </tr></thead><tbody>
            {(model.volumes ?? []).slice(0, 100).map((volume) => {
              const stress = volumeResultById.get(volume.id);
              return <tr key={volume.id}>
                <td>{volume.id}</td><td>{volume.kind === "tet4" ? "Tet4" : "Hex8"}</td><td>{volume.nodeIds.join(" · ")}</td>
                <td>{number(volume.eMpa, 1)}</td><td>{number(volume.poisson, 4)}</td><td>{volume.densityKgPerM3 === undefined ? "—" : number(volume.densityKgPerM3, 1)}</td>
                {result?.volume3D?.formulation === "totalLagrangian" && <>
                  <td>{number(volume.energyBeta ?? 0, 3)}</td>
                  <td>{stress?.effectiveEMpa === undefined ? "—" : number(stress.effectiveEMpa, 3)}</td>
                </>}
                {result?.volume3D && <>{stress ? stress.stressMpa.map((value, index) => <td key={index}>{signed(value, 4)}</td>)
                  : Array.from({ length: 6 }, (_, index) => <td key={index}>—</td>)}
                  <td>{stress ? number(stress.vonMisesMpa, 4) : "—"}</td></>}
                {(result?.volume3D?.formulation === "smallStrainMaterial" || result?.volume3D?.formulation === "totalLagrangianJ2")
                  && <><td>{stress?.equivalentPlasticStrain === undefined ? "—" : number(stress.equivalentPlasticStrain, 7)}</td>
                    <td>{stress?.tensileDamage === undefined ? "—" : number(stress.tensileDamage, 5)}</td></>}
              </tr>;
            })}
          </tbody></table>
          {(model.volumes?.length ?? 0) > 100 && <p className="frame3d-report-note">Eerste 100 van {model.volumes?.length} volume-elementen getoond; selecteer een element voor alle Gauss-spanningen.</p>}
          {result?.volume3D && (result.volume3D.membranes?.length ?? 0) > 0 && <>
            <h3>Gekoppelde Tri3-membranen</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Plaat</th><th>Spanningsmaat</th><th>σ11 [MPa]</th><th>σ22 [MPa]</th><th>τ12 [MPa]</th>
              <th>N11 [kN/m]</th><th>N22 [kN/m]</th><th>N12 [kN/m]</th>
              <th>εp,eq</th><th>Dikterekfactor</th>
            </tr></thead><tbody>
              {(result.volume3D.membranes ?? []).map((membrane) => <tr key={membrane.plateId}>
                <td>{membrane.plateId}</td>
                <td>{membrane.stressMeasure === "cauchy" ? "Cauchy, huidig"
                  : membrane.stressMeasure === "secondPiolaKirchhoff" ? "2e Piola–Kirchhoff, referentie"
                    : "Lineair, kleine rek"}</td>
                {membrane.stressMpa.map((value, index) => <td key={`s${index}`}>{signed(value, 4)}</td>)}
                {membrane.resultantsKnPerM.map((value, index) => <td key={`n${index}`}>{signed(value, 4)}</td>)}
                <td>{membrane.equivalentPlasticStrain === undefined ? "—" : number(membrane.equivalentPlasticStrain, 7)}</td>
                <td>{membrane.thicknessStretch === undefined ? "—" : number(membrane.thicknessStretch, 7)}</td>
              </tr>)}
            </tbody></table>
            <p className="frame3d-report-note">Membraanwaarden gelden in de lokale 1/2-assen van de plaat. Cauchy-spanning en N horen bij de huidige lengte en dikte; tweede Piola–Kirchhoff-spanning hoort bij de referentieconfiguratie. Buiging is niet in dit element opgenomen.</p>
          </>}
          {result?.volume3D && (result.volume3D.bendingPlates?.length ?? 0) > 0 && <>
            <h3>Gekoppelde XY-DKT-buigplaten</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Plaat</th><th>Tri3</th><th>Max. |w| [mm]</th><th>Max. |rotatie| [mrad]</th>
              <th>Max. |Mx| [kNm/m]</th><th>Max. |My| [kNm/m]</th><th>Max. |Mxy| [kNm/m]</th>
            </tr></thead><tbody>
              {result.volume3D.bendingPlates!.slice(0, 250).map((plate) => <tr key={plate.plateId}>
                <td>{plate.plateId}</td><td>{plate.triangleCount}</td>
                <td>{number(plate.maxAbsWm * 1000, 4)}</td>
                <td>{number(plate.maxAbsRotationRad * 1000, 4)}</td>
                {plate.maxAbsMomentKnmPerM
                  ? plate.maxAbsMomentKnmPerM.map((moment, axis) => <td key={axis}>{number(moment, 5)}</td>)
                  : [0, 1, 2].map((axis) => <td key={axis}>—</td>)}
              </tr>)}
            </tbody></table>
            {result.volume3D.bendingPlates!.length > 250 && <p className="frame3d-report-note">
              Eerste 250 van {result.volume3D.bendingPlates!.length} platen getoond; de overige blijven in het berekeningsresultaat.
            </p>}
            {dktTriangleCount > 0 && <><h4>Elastische centroidmomenten per driehoek</h4>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Plaat</th><th>Tri3</th><th>Knoop-ID's</th><th>Mx [kNm/m]</th><th>My [kNm/m]</th><th>Mxy [kNm/m]</th>
            </tr></thead><tbody>
              {dktVisibleTriangles.map((triangle) => <tr key={`${triangle.plateId}-${triangle.triangleIndex}`}>
                <td>{triangle.plateId}</td><td>{triangle.triangleIndex}</td><td>{triangle.nodeIds.join(" / ")}</td>
                {triangle.momentKnmPerM.map((moment, axis) => <td key={axis}>{signed(moment, 6)}</td>)}
              </tr>)}
            </tbody></table>
            {dktTriangleCount > 250 && <p className="frame3d-report-note">
              Eerste 250 van {dktTriangleCount} driehoeken getoond; {dktTriangleCount - 250} overige blijven in het berekeningsresultaat.
            </p>}</>}
            <p className="frame3d-report-note">{dktTriangleCount > 0
              ? "De momenten zijn elastische globale XY-resultanten in het zwaartepunt van elke driehoek, herleid uit de laatste verplaatsingen met vaste referentiestijfheid; een positieve waarde wordt zonder aanvullende tekenomzetting getoond. Eigen plaat-GNL/FNL is niet berekend."
              : "De XY-DKT-platen behouden elastische referentiestijfheid in de volume-GNL/J2-berekening. Eigen plaat-GNL/FNL en plaatmomenten zijn niet herleid."} Deze horizontale platen dragen alleen buiging. Plaatmembraan, dwarskrachtresultanten, oppervlaktespanning en constructieve plaattoetsing zijn niet berekend.</p>
          </>}
        </section>}

        {!result ? <>
          <section className="frame3d-report-empty">
            <h2>Nog niet berekend</h2>
            <p>De modelinvoer hieronder kan worden afgedrukt. Tweede-orde-, knik- en staafresultaten ontbreken nog.</p>
            {(model.plates?.length ?? 0) > 0 && <p>Voor één losse vlakke rechthoekige plaat, eventueel met rechthoekige openingen, is een lineaire of FNL Open FEM Rust-berekening beschikbaar. FNL vereist een opgegeven E-rekcurve; andere 3D-plaatmodellen worden expliciet geweigerd.</p>}
          </section>
          {(model.plates?.length ?? 0) > 0 && <section>
            <h2>Platen en openingen</h2>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Plaat</th><th>Contourknopen</th><th>Rand</th><th>Dikte</th><th>Randstraal</th><th>Materiaal</th><th>Celmaat</th><th>Randopleggingen</th><th>E-rekcurve [MPa]</th><th>Wapening</th><th>Drielageninvoer</th><th>Openingen</th>
            </tr></thead><tbody>
              {(model.plates ?? []).map((plate) => <tr key={plate.id}>
                <td>{plate.id}</td><td>{plate.nodeIds.join(" · ")}</td><td>{plate.boundary ? `${plate.boundary.length} segmenten (${plate.boundary.filter((segment) => segment.kind === "arc").length} boog)` : "hoekpunten"}</td><td>{number(plate.thicknessM)} m</td>
                <td>{number(plate.cornerRadiusM ?? 0)} m</td><td>{plate.material || "—"}</td>
                <td>{plate.maxCellSizeM ? `${number(plate.maxCellSizeM)} m` : "automatisch"}</td>
                <td>{(plate.edgeSupports ?? ["free", "free", "free", "free"]).map((kind, index) => `${index + 1}:${kind === "free" ? "vrij" : kind === "clamped" ? "vast" : "scharnier"}`).join(" · ")}</td>
                <td>{plate.modulusCurve?.map((point) => `${number(point.strain, 8)}:${number(point.eMpa, 1)}`).join(" → ") ?? "—"}</td>
                <td>{plate.reinforcement ? `${plate.reinforcement.limitState === "ultimate" ? "UGT" : "BGT"}; As ${[plate.reinforcement.topXMm2PerM, plate.reinforcement.topYMm2PerM, plate.reinforcement.bottomXMm2PerM, plate.reinforcement.bottomYMm2PerM].map((area) => number(area, 0)).join("/")} mm²/m` : "—"}</td>
                <td>{plate.threeLayer ? `${plate.threeLayer.compressionModel === "blaauwendraad2021" ? "Blaauwendraad 2021" : "EC2 F"}; huid ${number(plate.threeLayer.topSkinMm, 1)}/${number(plate.threeLayer.bottomSkinMm, 1)} mm; fcd/fyd ${number(plate.threeLayer.fcdMpa, 1)}/${number(plate.threeLayer.fydMpa, 1)} MPa; As boven ${number(plate.threeLayer.topReinforcement.asX, 0)}/${number(plate.threeLayer.topReinforcement.asY, 0)}, onder ${number(plate.threeLayer.bottomReinforcement.asX, 0)}/${number(plate.threeLayer.bottomReinforcement.asY, 0)} mm²/m${plate.threeLayer.core ? `; vRdc ${number(plate.threeLayer.core.vRdcKnPerM, 1)} kN/m, tan θ ${number(plate.threeLayer.core.tanTheta, 2)}, Asv ${number(plate.threeLayer.core.providedShearMm2PerM2, 0)} mm²/m²` : "; kernschuif niet opgegeven"}` : "—"}</td>
                <td>{(plate.openings ?? []).length === 0 ? "—" : (plate.openings ?? []).map((opening) =>
                  `#${opening.id}: ${opening.nodeIds.join(" · ")} (r=${number(opening.cornerRadiusM ?? 0)} m)`).join("; ")}</td>
              </tr>)}
            </tbody></table>
            {(model.surfaceLoads?.length ?? 0) > 0 && <>
              <h3>Oppervlaktebelastingen</h3>
              <table className="frame3d-report-wide"><thead><tr>
                <th>ID</th><th>Geval</th><th>Plaat</th><th>qx</th><th>qy</th><th>qz</th>
              </tr></thead><tbody>
                {(model.surfaceLoads ?? []).map((load) => <tr key={load.id}>
                  <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{load.plateId}</td>
                  <td>{signed(load.qx)}</td><td>{signed(load.qy)}</td><td>{signed(load.qz)}</td>
                </tr>)}
              </tbody></table>
              <p className="frame3d-report-note">Intensiteiten in kN/m² en globale assen X/Y/Z.</p>
            </>}
            {(model.plateEdgeLoads?.length ?? 0) > 0 && <>
              <h3>Randlijnlasten</h3>
              <table className="frame3d-report-wide"><thead><tr>
                <th>ID</th><th>Geval</th><th>Plaat</th><th>Zijde</th><th>Begin</th><th>Eind</th><th>Factor</th>
              </tr></thead><tbody>
                {plateEdgeLoads.map((load) => <tr key={load.id}>
                  <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{load.plateId}</td><td>{load.edgeIndex + 1}</td>
                  <td>{signed(load.startKnPerM)} kN/m</td><td>{signed(load.endKnPerM)} kN/m</td><td>{number(load.loadFactor)}</td>
                </tr>)}
              </tbody></table>
              <p className="frame3d-report-note">Lineaire intensiteitsverdeling langs de buitenrand, positief in de plaatnormaal.</p>
            </>}
          </section>}
        </> : <>
          <section>
            <h2>Samenvatting</h2>
            <div className="frame3d-report-cards">
              <div><span>Analyse</span><strong>{result.volume3D?.formulation === "totalLagrangianJ2" ? "GNL + J2-staal-FNL (Tet4)"
                : result.volume3D?.formulation === "totalLagrangian" ? "GNL Tet4 (totale Lagrange)"
                : result.analysis === "combined" ? "2e orde + FNL (GNL + materiaal)"
                : result.analysis === "p-delta" ? "2e orde (P-Δ)"
                  : result.analysis === "material" ? "Fysisch niet-lineair" : "1e orde"}</strong></div>
              {result.materialLoadPath && <div><span>FNL-lastpad</span><strong>{result.materialLoadPath.join(" → ")}</strong></div>}
              <div><span>Rekentoestand</span><strong>{activeCombinationName || activeLoadCaseName || `Geval ${activeLoadCaseId}`}</strong></div>
              <div><span>Max. verplaatsing</span><strong>{number(maxDisplacement * 1000)} mm</strong></div>
              <div><span>Convergentie</span><strong>{result.volume3D?.newtonIterations !== undefined
                ? `${result.volume3D.newtonIterations} Newton-iteraties`
                : result.materialIterations !== undefined
                ? `${result.materialIterations} materiaaliteraties`
                : result.secondOrder ? `${result.secondOrder.iterations} iteratie${result.secondOrder.iterations === 1 ? "" : "s"}` : "direct"}</strong></div>
              <div><span>Eerste knikfactor αcr</span><strong>{firstMode ? number(firstMode.loadFactor) : "n.v.t."}</strong></div>
              <div><span>Evenwicht</span><strong className={equilibrium?.equilibriumOk === true && result.forceBalance?.ok !== false ? "frame3d-report-good" : "frame3d-report-bad"}>{equilibrium?.equilibriumOk === true && result.forceBalance?.ok !== false ? "akkoord" : equilibrium?.equilibriumOk === false || result.forceBalance?.ok === false ? "afwijking" : "niet geverifieerd"}</strong></div>
              {result.forceBalance && <div><span>Globale krachtensom</span><strong className={result.forceBalance.maxImbalanceKn <= result.forceBalance.toleranceKn ? "frame3d-report-good" : "frame3d-report-bad"}>{result.forceBalance.maxImbalanceKn <= result.forceBalance.toleranceKn ? "akkoord" : `${number(result.forceBalance.maxImbalanceKn, 4)} kN afwijking`}</strong></div>}
              {result.forceBalance && <div><span>Globale momentensom</span><strong className={result.forceBalance.maxMomentImbalanceKnm <= result.forceBalance.momentToleranceKnm ? "frame3d-report-good" : "frame3d-report-bad"}>{result.forceBalance.maxMomentImbalanceKnm === undefined ? "niet geverifieerd" : result.forceBalance.maxMomentImbalanceKnm <= result.forceBalance.momentToleranceKnm ? "akkoord" : `${number(result.forceBalance.maxMomentImbalanceKnm, 4)} kNm afwijking`}</strong></div>}
              <div><span>Max. versterking</span><strong>{result.secondOrder ? number(result.secondOrder.maxAmplification) : "1,000"}</strong></div>
            </div>
          </section>

          {result.plateBending && <section>
            <h2>Buigplaatresultaat · plaat {result.plateBending.plateId}</h2>
            {plateReinforcement && <table className="frame3d-report-wide"><tbody>
              <tr><th>Toetsinvoer</th><td>{plateReinforcement.limitState === "ultimate" ? "UGT" : "BGT"}</td>
                <th>Beton</th><td>fck {number(plateReinforcement.fckMpa)} MPa · fctm {number(plateReinforcement.fctmMpa)} MPa · γc {number(plateReinforcement.gammaC)}</td></tr>
              <tr><th>Staal</th><td>fyd {number(plateReinforcement.fydMpa)} MPa · fywd {number(plateReinforcement.fywdMpa)} MPa · Es {number(plateReinforcement.esMpa, 0)} MPa</td>
                <th>Doorsnede</th><td>dekking {number(plateReinforcement.coverMm)} mm · Ø {number(plateReinforcement.barDiameterMm)} mm · z {plateReinforcement.leverArmMm === undefined ? "automatisch" : `${number(plateReinforcement.leverArmMm)} mm`}</td></tr>
              <tr><th>As boven X/Y</th><td>{number(plateReinforcement.topXMm2PerM, 0)} / {number(plateReinforcement.topYMm2PerM, 0)} mm²/m</td>
                <th>As onder X/Y</th><td>{number(plateReinforcement.bottomXMm2PerM, 0)} / {number(plateReinforcement.bottomYMm2PerM, 0)} mm²/m</td></tr>
              <tr><th>Dwarskracht</th><td>Asw {number(plateReinforcement.shearMm2PerM2 ?? 0, 0)} mm²/m² · tanθ {number(plateReinforcement.tanTheta ?? 1)} · αcc {number(plateReinforcement.alphaCc ?? 1)}</td>
                <th>Scheurgrens</th><td>{plateReinforcement.crackLimitMm === undefined ? "niet opgegeven" : `${number(plateReinforcement.crackLimitMm)} mm`}{plateReinforcement.longTerm ? " · langdurend" : ""}</td></tr>
              {plateReinforcement.cRdc !== undefined && <tr><th>C_Rd,c</th><td>{number(plateReinforcement.cRdc)}</td><td colSpan={2} /></tr>}
            </tbody></table>}
            <p className="frame3d-report-note">Hybride Q4-buigplaat in lokale plaatassen. Hoekopleggingen komen uit het 3D-model; opgegeven randopleggingen gelden voor alle randroosterknopen. w is positief volgens de lokale plaatnormaal.</p>
            <p className="frame3d-report-note">{result.analysis === "p-delta"
              ? plateNonlinearLaw
                ? `De Rust-plaatroute koppelt geometrische membraanrek en hybride plaatbuiging met von-Kármán-rekken. De ${plateNonlinearLaw.kind}-wet bewaart de materiaaltoestand op de shellmembraanpunten; de buigdoorsnede blijft elastisch/secant-E.`
                : `De Rust-plaatroute koppelt geometrische membraanrek en hybride plaatbuiging met von-Kármán-rekken. εmax is de piek-hoofdrek aan beide plaatzijden op de Gauss-punten; ${plateInput?.modulusCurve?.length ? "Eeff volgt de secant-E-rekhistorie." : "deze run gebruikt de elastische E-modulus."}`
              : result.analysis === "material"
              ? "De elementen gebruiken een secant-E op de bereikte maximale vezelrek. Dit is geen expliciete scheur- of plastische doorsnedewet."
              : "Dit overzicht bevat elastische snedekrachten."} {result.plateBending.elements.some((element) => element.reinforcement)
                ? "De wapeningscontrole gebruikt de snedekrachten in de laatste lasttoestand en is per element op hoek- en integratiepunten bepaald. Extremen ertussen, scheurhistorie en normcombinaties zijn niet automatisch afgedekt."
                : "Plaatwapening en scheurwijdte zijn niet getoetst."}</p>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Element</th><th>Mx [kNm/m]</th><th>My [kNm/m]</th><th>Mxy [kNm/m]</th><th>Vx [kN/m]</th><th>Vy [kN/m]</th><th>Eeff [MPa]</th>{result.analysis === "p-delta" && <th>εmax [-]</th>}
              {plateNonlinearLaw && <><th>εp,eq,max [-]</th><th>Dtrek,max [-]</th></>}
            </tr></thead><tbody>
              {result.plateBending.elements.map((element) => <tr key={element.quadId}>
                <td>{element.quadId}</td>
                {element.momentKnmPerM.map((value, index) => <td key={`m${index}`}>{signed(value)}</td>)}
                {element.shearKnPerM.map((value, index) => <td key={`v${index}`}>{signed(value)}</td>)}
                <td>{number(element.effectiveEMpa)}</td>
                {result.analysis === "p-delta" && <td>{number(element.maxCombinedStrain ?? Number.NaN, 6)}</td>}
                {plateNonlinearLaw && <>
                  <td>{number(element.maxEquivalentPlasticStrain ?? Number.NaN, 6)}</td>
                  <td>{number(element.maxTensileDamage ?? Number.NaN, 4)}</td>
                </>}
              </tr>)}
            </tbody></table>
            {plateNonlinearLaw && <details className="frame3d-report-details">
              <summary>Materiaaltoestand per shell-Gauss-punt</summary>
              <table className="frame3d-report-wide"><thead><tr>
                <th>Element</th><th>Gauss-punt</th><th>x [m]</th><th>y [m]</th>
                <th>εx</th><th>εy</th><th>γxy</th><th>εp,eq</th><th>Dtrek</th>
              </tr></thead><tbody>
                {result.plateBending.elements.flatMap((element) => (element.materialPoints ?? []).map((point) =>
                  <tr key={`${element.quadId}-${point.gaussIndex.join("-")}`}>
                    <td>{element.quadId}</td><td>{point.gaussIndex.map((index) => index + 1).join(", ")}</td>
                    <td>{number(point.positionM[0], 4)}</td><td>{number(point.positionM[1], 4)}</td>
                    {point.membraneStrain.map((value, index) => <td key={index}>{number(value, 7)}</td>)}
                    <td>{number(point.equivalentPlasticStrain, 7)}</td><td>{number(point.tensileDamage, 5)}</td>
                  </tr>))}
              </tbody></table>
            </details>}
            {result.plateBending.elements.some((element) => element.reinforcement) && <>
              <h3>Wapenings- en scheurtoets op de gekozen rekentoestand</h3>
              <table className="frame3d-report-wide"><thead><tr>
                <th>Element</th><th>Toestand</th><th>Steekpunten</th><th>As,req max [mm²/m]</th>
                <th>V,req [mm²/m²]</th><th>V,aanw [mm²/m²]</th><th>Betondrukstaaf UC</th>
                <th>wk,max [mm]</th><th>Toets</th>
              </tr></thead><tbody>
                {result.plateBending.elements.map((element) => {
                  const check = element.reinforcement;
                  if (!check) return null;
                  const crackWidths = check.crack?.map((entry) => entry.check.characteristicWidthMm ?? 0) ?? [];
                  const crackFailure = check.crack?.some((entry) => entry.check.unreinforcedTension
                    || entry.check.passesLimit === false) ?? false;
                  const crackLimitMissing = check.limitState === "service"
                    && (check.crack?.some((entry) => entry.check.passesLimit === null) ?? true);
                  const longitudinalFailure = check.longitudinal?.sufficient.some((ok) => !ok) ?? false;
                  const shearFailure = (check.shear ? !check.shear.check.shearReinforcementSufficient
                    || !check.shear.check.strutSufficient : false)
                    || (check.maximumStrutUtilization ?? 0) > 1;
                  return <tr key={element.quadId}><td>{element.quadId}</td>
                    <td>{check.limitState === "ultimate" ? "UGT" : "BGT"}</td><td>{check.checkedPoints}</td>
                    <td>{check.longitudinal ? number(Math.max(...check.longitudinal.requiredMm2PerM), 1) : "—"}</td>
                    <td>{check.shear ? number(check.shear.check.requiredShearMm2PerM2, 1) : "—"}</td>
                    <td>{check.shear ? number(check.shear.check.providedShearMm2PerM2, 1) : "—"}</td>
                    <td>{check.maximumStrutUtilization === undefined ? "—" : number(check.maximumStrutUtilization, 3)}</td>
                    <td>{crackWidths.length ? number(Math.max(...crackWidths), 3) : "—"}</td>
                    <td className={crackFailure || longitudinalFailure || shearFailure ? "frame3d-report-bad"
                      : crackLimitMissing ? "" : "frame3d-report-good"}>
                      {crackFailure || longitudinalFailure || shearFailure ? "voldoet niet"
                        : crackLimitMissing ? "scheurgrens ontbreekt" : "akkoord"}</td>
                  </tr>;
                })}
              </tbody></table>
            </>}
            {result.plateBending.elements.some((element) => element.threeLayer) && <>
              <h3>Blaauwendraad drie-lagen-deelcontrole op plaatresultaatpunten</h3>
              <p className="frame3d-report-note">Bij in-vlakse knoop- of oppervlaktebelasting komen de membraanresultanten uit een aparte Rust-Q4-oplossing; zonder in-vlakse belasting is N nul. Buiging en membraanwerking zijn niet geometrisch gekoppeld. De controle gebruikt momenten en dwarskrachten op hoek-, midden- en 4×4 Gauss-punten; alleen de opgegeven deelcontroles zijn beoordeeld.</p>
              <table className="frame3d-report-wide"><thead><tr>
                <th>Element</th><th>Punten</th><th>Boven max As,x UC</th><th>Boven max As,y UC</th>
                <th>Boven druk UC</th><th>Boven geval</th><th>Onder max As,x UC</th><th>Onder max As,y UC</th>
                <th>Onder druk UC</th><th>Onder geval</th>
                <th>Kern Asv UC</th><th>Kern diagonaal UC</th><th>Maatgevend lokaal punt [m]</th><th>Status</th>
              </tr></thead><tbody>
                {result.plateBending.elements.map((element) => {
                  const check = element.threeLayer;
                  if (!check) return null;
                  return <tr key={element.quadId}>
                    <td>{element.quadId}</td><td>{check.checkedPoints}</td>
                    <td>{number(check.top.utilizationAsX, 3)}</td><td>{number(check.top.utilizationAsY, 3)}</td>
                    <td>{number(check.top.utilizationCompression, 3)}</td><td>{reinforcementCaseLabel(check.top.reinforcementCase)}</td>
                    <td>{number(check.bottom.utilizationAsX, 3)}</td><td>{number(check.bottom.utilizationAsY, 3)}</td>
                    <td>{number(check.bottom.utilizationCompression, 3)}</td><td>{reinforcementCaseLabel(check.bottom.reinforcementCase)}</td>
                    <td>{check.core.utilizationShear === null ? "—" : number(check.core.utilizationShear, 3)}</td>
                    <td>{check.core.utilizationDiagonal === null ? "—" : number(check.core.utilizationDiagonal, 3)}</td>
                    <td>{check.governingPositionM.map((value) => number(value, 4)).join(" / ")}</td>
                    <td className={check.status === "partial_check_exceeded" ? "frame3d-report-bad" : "frame3d-report-good"}>
                      {check.status === "partial_check_exceeded" ? "deelcontrole overschreden" : "deelcontrole binnen grens"}
                    </td>
                  </tr>;
                })}
              </tbody></table>
              <p className="frame3d-report-note">Niet beoordeeld: {[...new Set(result.plateBending.elements
                .flatMap((element) => element.threeLayer?.notAssessed ?? []))].join(", ") || "—"}.</p>
            </>}
            <h3>Reacties op vastgezette roosterknopen</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Knoop</th><th>X [m]</th><th>Y [m]</th><th>Z [m]</th><th>Fx [kN]</th><th>Fy [kN]</th><th>Fz [kN]</th><th>Mx [kNm]</th><th>My [kNm]</th><th>Mz [kNm]</th>
            </tr></thead><tbody>
              {result.plateBending.reactions.map((reaction) => <tr key={reaction.meshNodeId}>
                <td>{reaction.meshNodeId}</td><td>{number(reaction.x)}</td><td>{number(reaction.y)}</td><td>{number(reaction.z)}</td>
                <td>{signed(reaction.fx)}</td><td>{signed(reaction.fy)}</td><td>{signed(reaction.fz)}</td>
                <td>{signed(reaction.mx)}</td><td>{signed(reaction.my)}</td><td>{signed(reaction.mz)}</td>
              </tr>)}
            </tbody></table>
            <h3>Roosterknoopverplaatsingen</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Knoop</th><th>X [m]</th><th>Y [m]</th><th>Z [m]</th><th>w [mm]</th><th>θx lokaal [rad]</th><th>θy lokaal [rad]</th>
            </tr></thead><tbody>
              {result.plateBending.nodes.map((node) => <tr key={node.meshNodeId}>
                <td>{node.meshNodeId}</td><td>{number(node.x)}</td><td>{number(node.y)}</td><td>{number(node.z)}</td>
                <td>{signed(node.wM * 1000, 5)}</td><td>{signed(node.thetaXRad, 6)}</td><td>{signed(node.thetaYRad, 6)}</td>
              </tr>)}
            </tbody></table>
          </section>}

          <section>
            <h2>3D model- en resultaatweergaven</h2>
            <Frame3DReportViews model={model} result={result} checks={checks} concreteChecks={concreteChecks} />
          </section>

          {combinationResults && combinationResults.size > 0 && <section>
            <h2>Belastingcombinaties</h2>
            <table className="frame3d-report-wide"><thead><tr>
              <th>ID</th><th>Combinatie</th><th>Type</th><th>Δmax [mm]</th><th>P-Δ</th><th>αcr</th>
            </tr></thead><tbody>
              {combinations.filter((combination) => combinationResults.has(combination.id)).map((combination) => {
                const combinationResult = combinationResults.get(combination.id)!;
                const displacement = frame3DMaximumDisplacementM(model, combinationResult) * 1000;
                const alphaCr = combinationResult.buckling.status === "available"
                  ? combinationResult.buckling.modes[0]?.loadFactor
                  : undefined;
                return <tr key={combination.id}>
                  <td>{combination.id}</td><td>{combination.name}</td><td>{combination.type === "uls" ? "UGT" : "BGT"}</td>
                  <td>{number(displacement)}</td>
                  <td>{combinationResult.secondOrder?.converged === false ? "niet geconvergeerd" : `${combinationResult.secondOrder?.iterations ?? 0} iter.`}</td>
                  <td>{alphaCr === undefined ? "—" : number(alphaCr)}</td>
                </tr>;
              })}
            </tbody></table>
          </section>}

          <section>
            <h2>Randvoorwaarden en belastingen</h2>
            <h3>Staven en lokale assen</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Staaf</th><th>Profiel</th><th>Rotatie</th><th>Scharnieren begin</th><th>Scharnieren eind</th>
            </tr></thead><tbody>
              {model.beams.map((beam) => {
                const begin = [beam.releases?.torsionStart && "T", beam.releases?.myStart && "My", beam.releases?.mzStart && "Mz"].filter(Boolean).join(", ") || "—";
                const eind = [beam.releases?.torsionEnd && "T", beam.releases?.myEnd && "My", beam.releases?.mzEnd && "Mz"].filter(Boolean).join(", ") || "—";
                return <tr key={beam.id}><td>{beam.id}</td><td>{beam.profileName ?? "—"} · {beam.material ?? "—"}</td>
                  <td>{number((beam.rollAngleRad ?? 0) * 180 / Math.PI)}°</td><td>{begin}</td><td>{eind}</td></tr>;
              })}
            </tbody></table>
            {(model.plates?.length ?? 0) > 0 && <>
              <h3>Platen en openingen</h3>
              <table className="frame3d-report-wide"><thead><tr>
                <th>Plaat</th><th>Contourknopen</th><th>Rand</th><th>Dikte</th><th>Randstraal</th><th>Materiaal</th><th>Celmaat</th><th>Randopleggingen</th><th>E-rekcurve [MPa]</th><th>Wapening</th><th>Drielageninvoer</th><th>Openingen</th>
              </tr></thead><tbody>
                {(model.plates ?? []).map((plate) => <tr key={plate.id}>
                  <td>{plate.id}</td><td>{plate.nodeIds.join(" · ")}</td><td>{plate.boundary ? `${plate.boundary.length} segmenten (${plate.boundary.filter((segment) => segment.kind === "arc").length} boog)` : "hoekpunten"}</td><td>{number(plate.thicknessM)} m</td>
                  <td>{number(plate.cornerRadiusM ?? 0)} m</td><td>{plate.material || "—"}</td>
                  <td>{plate.maxCellSizeM ? `${number(plate.maxCellSizeM)} m` : "automatisch"}</td>
                  <td>{(plate.edgeSupports ?? ["free", "free", "free", "free"]).map((kind, index) => `${index + 1}:${kind === "free" ? "vrij" : kind === "clamped" ? "vast" : "scharnier"}`).join(" · ")}</td>
                  <td>{plate.modulusCurve?.map((point) => `${number(point.strain, 8)}:${number(point.eMpa, 1)}`).join(" → ") ?? "—"}</td>
                  <td>{plate.reinforcement ? `${plate.reinforcement.limitState === "ultimate" ? "UGT" : "BGT"}; As ${[plate.reinforcement.topXMm2PerM, plate.reinforcement.topYMm2PerM, plate.reinforcement.bottomXMm2PerM, plate.reinforcement.bottomYMm2PerM].map((area) => number(area, 0)).join("/")} mm²/m` : "—"}</td>
                  <td>{plate.threeLayer ? `${plate.threeLayer.compressionModel === "blaauwendraad2021" ? "Blaauwendraad 2021" : "EC2 F"}; huid ${number(plate.threeLayer.topSkinMm, 1)}/${number(plate.threeLayer.bottomSkinMm, 1)} mm; fcd/fyd ${number(plate.threeLayer.fcdMpa, 1)}/${number(plate.threeLayer.fydMpa, 1)} MPa; As boven ${number(plate.threeLayer.topReinforcement.asX, 0)}/${number(plate.threeLayer.topReinforcement.asY, 0)}, onder ${number(plate.threeLayer.bottomReinforcement.asX, 0)}/${number(plate.threeLayer.bottomReinforcement.asY, 0)} mm²/m${plate.threeLayer.core ? `; vRdc ${number(plate.threeLayer.core.vRdcKnPerM, 1)} kN/m, tan θ ${number(plate.threeLayer.core.tanTheta, 2)}, Asv ${number(plate.threeLayer.core.providedShearMm2PerM2, 0)} mm²/m²` : "; kernschuif niet opgegeven"}` : "—"}</td>
                  <td>{(plate.openings ?? []).length === 0 ? "—" : (plate.openings ?? []).map((opening) =>
                    `#${opening.id}: ${opening.nodeIds.join(" · ")} (r=${number(opening.cornerRadiusM ?? 0)} m)`).join("; ")}</td>
                </tr>)}
              </tbody></table>
            </>}
            <h3>Opleggingen</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Knoop</th><th>Type</th><th>Geblokkeerde vrijheidsgraden</th><th>Veren</th><th>Opgelegde waarden</th><th>Vrije rotatie-as</th>
            </tr></thead><tbody>
              {(model.supports ?? []).map((support) => {
                const kind = frame3DSupportPresetOf(support);
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
                return <tr key={support.nodeId}><td>{support.nodeId}</td><td>{SUPPORT_LABELS[kind]}</td><td>{restrained || "—"}</td><td>{springs}</td><td>{prescribed}</td><td>{freeAxis}</td></tr>;
              })}
            </tbody></table>
            <h3>Knoopbelastingen</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>ID</th><th>Geval</th><th>Factor</th><th>Knoop</th><th>Fx</th><th>Fy</th><th>Fz</th><th>Mx</th><th>My</th><th>Mz</th>
            </tr></thead><tbody>
              {nodalLoads.map((load) => <tr key={load.id}>
                <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td><td>{load.nodeId}</td><td>{signed(load.fx)}</td><td>{signed(load.fy)}</td><td>{signed(load.fz)}</td>
                <td>{signed(load.mx)}</td><td>{signed(load.my)}</td><td>{signed(load.mz)}</td>
              </tr>)}
            </tbody></table>
            <p className="frame3d-report-note">Krachten in kN; momenten in kNm. Globale assen X/Y/Z.</p>
            {surfaceLoads.length > 0 && <>
              <h3>Oppervlaktebelastingen</h3>
              <table className="frame3d-report-wide"><thead><tr>
                <th>ID</th><th>Geval</th><th>Factor</th><th>Plaat</th><th>qx</th><th>qy</th><th>qz</th>
              </tr></thead><tbody>
                {surfaceLoads.map((load) => <tr key={load.id}>
                  <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td><td>{load.plateId}</td>
                  <td>{signed(load.qx)}</td><td>{signed(load.qy)}</td><td>{signed(load.qz)}</td>
                </tr>)}
              </tbody></table>
              <p className="frame3d-report-note">Intensiteiten in kN/m² en globale assen X/Y/Z.</p>
            </>}
            {plateEdgeLoads.length > 0 && <>
              <h3>Plaat-randlijnbelastingen</h3>
              <table className="frame3d-report-wide"><thead><tr>
                <th>ID</th><th>Geval</th><th>Factor</th><th>Plaat</th><th>Zijde</th><th>Begin</th><th>Eind</th>
              </tr></thead><tbody>
                {plateEdgeLoads.map((load) => <tr key={load.id}>
                  <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td>
                  <td>{load.plateId}</td><td>{load.edgeIndex + 1}</td>
                  <td>{signed(load.startKnPerM)}</td><td>{signed(load.endKnPerM)}</td>
                </tr>)}
              </tbody></table>
              <p className="frame3d-report-note">Lineaire normaalbelasting langs de buitenrand, intensiteiten in kN/m. De getoonde waarden bevatten de actieve combinatie-factor.</p>
            </>}
            <h3>Staafbelastingen</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>ID</th><th>Geval</th><th>Factor</th><th>Staaf</th><th>qy begin</th><th>qy eind</th><th>qz begin</th><th>qz eind</th><th>Bereik</th>
            </tr></thead><tbody>
              {memberLoads.map((load) => <tr key={load.id}>
                <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td><td>{load.beamId}</td>
                <td>{signed(load.qyStart)}</td><td>{signed(load.qyEnd)}</td>
                <td>{signed(load.qzStart)}</td><td>{signed(load.qzEnd)}</td>
                <td>{number(load.startPositionM)}–{number(load.endPositionM)} m</td>
              </tr>)}
            </tbody></table>
            <p className="frame3d-report-note">Intensiteiten in kN/m en lokale staafassen y/z.</p>
            <h3>Staafpuntlasten</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>ID</th><th>Geval</th><th>Factor</th><th>Staaf</th><th>Py</th><th>Pz</th><th>Positie</th>
            </tr></thead><tbody>
              {memberPointLoads.map((load) => <tr key={load.id}>
                <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td><td>{load.beamId}</td>
                <td>{signed(load.py)}</td><td>{signed(load.pz)}</td><td>{number(load.positionM)} m</td>
              </tr>)}
            </tbody></table>
            <p className="frame3d-report-note">Krachten in kN en lokale staafassen y/z.</p>
            <h3>Temperatuurbelastingen</h3>
            <table className="frame3d-report-wide"><thead><tr>
              <th>ID</th><th>Geval</th><th>Factor</th><th>Staaf</th><th>ΔT uniform</th><th>ΔT lokaal y</th><th>ΔT lokaal z</th>
            </tr></thead><tbody>
              {thermalLoads.map((load) => <tr key={load.id}>
                <td>{load.id}</td><td>{load.caseId ?? 1}</td><td>{number(load.loadFactor, 3)}</td><td>{load.beamId}</td>
                <td>{signed(load.deltaTUniformK)}</td><td>{signed(load.deltaTGradientYK)}</td><td>{signed(load.deltaTGradientZK)}</td>
              </tr>)}
            </tbody></table>
            <p className="frame3d-report-note">Temperatuurverschillen in K; gradiënten volgen de lokale doorsnede-assen.</p>
          </section>

          <section>
            <h2>Rekenmethode en controle</h2>
            <table><tbody>
              <tr><th>Rekenkern</th><td>{result.engine.name}</td></tr>
              <tr><th>Vastgezette revisie</th><td><code>{result.engine.revision.slice(0, 12)}</code></td></tr>
              <tr><th>Licentie</th><td>{result.engine.license}</td></tr>
              {result.materialLoadPath && <tr><th>Laatste lastfactor</th><td>{number(result.materialLoadPath[result.materialLoadPath.length - 1], 4)}</td></tr>}
              <tr><th>{result.analysis === "material" || result.analysis === "combined" ? "FNL-iteratie" : "Tweede orde"}</th><td>{result.materialIterations !== undefined
                ? `${result.materialIterations} iteraties; geconvergeerd`
                : result.secondOrder ? `${result.secondOrder.converged ? "geconvergeerd" : "niet geconvergeerd"}; ${result.secondOrder.stable ? "stabiel" : "instabiel"}` : "niet uitgevoerd"}</td></tr>
              <tr><th>Relatief evenwichtsresidu</th><td>{equilibrium ? number(equilibrium.relativeResidual, 8) : "niet beschikbaar"}</td></tr>
              <tr><th>Max. onbalans</th><td>{equilibrium ? `${number(equilibrium.maxImbalanceKn, 8)} kN` : "niet beschikbaar"}</td></tr>
              {result.forceBalance && <tr><th>Onafhankelijke krachtensom X/Y/Z</th><td>{result.forceBalance.imbalanceKn.map((value) => number(value, 5)).join(" / ")} kN (grens {number(result.forceBalance.toleranceKn, 5)} kN)</td></tr>}
              {result.forceBalance?.momentImbalanceKnm && <tr><th>Onafhankelijke momentensom X/Y/Z</th><td>{result.forceBalance.momentImbalanceKnm.map((value) => number(value, 5)).join(" / ")} kNm (grens {number(result.forceBalance.momentToleranceKnm, 5)} kNm)</td></tr>}
            </tbody></table>
          </section>

          <section>
            <h2>Knikanalyse</h2>
            {result.buckling.status === "available" ? <>
              <table><thead><tr><th>Modus</th><th>Lastfactor αcr</th></tr></thead><tbody>
                {result.buckling.modes.map((mode) => <tr key={mode.mode}><td>{mode.mode}</td><td>{number(mode.loadFactor, 5)}</td></tr>)}
              </tbody></table>
              <h3>Drukstaven</h3>
              <table className="frame3d-report-wide"><thead><tr><th>Staaf</th><th>N (kN)</th><th>Ncr (kN)</th><th>Lcr (m)</th><th>λy</th><th>λz</th></tr></thead><tbody>
                {result.buckling.members.map((member) => <tr key={member.memberId}>
                  <td>{member.memberId}</td><td>{signed(member.axialForceKn)}</td><td>{number(member.criticalForceKn)}</td>
                  <td>{number(member.effectiveLengthM)}</td><td>{number(member.slendernessY)}</td><td>{number(member.slendernessZ)}</td>
                </tr>)}
              </tbody></table>
            </> : <p>{result.buckling.reason}</p>}
          </section>

          <section>
            <h2>EN 1993 staaltoetsing</h2>
            {checksRunning && <p>De normtoetsing wordt uitgevoerd…</p>}
            {checksError && <p className="frame3d-report-bad">Normtoetsing: {checksError}</p>}
            {!checksRunning && !checksError && checks && checks.results.length > 0 && <>
              <table className="frame3d-report-wide"><thead><tr>
                <th>Staaf</th><th>Profiel</th><th>Staal</th><th>Klasse</th><th>UC UGT</th><th>Maatgevend</th><th>Status</th>
              </tr></thead><tbody>
                {checks.results.map((check) => {
                  const uc = frame3DUlsUc(check);
                  const governing = frame3DGoverningUlsCheck(check);
                  return <tr key={check.beam_id}>
                    <td>{check.beam_id}</td><td>{check.profile_name}</td><td>{check.steel_grade}</td><td>{check.classification}</td>
                    <td>{number(uc)}</td><td>{governing?.kind.data.title ?? "—"}</td>
                    <td className={uc <= 1 ? "frame3d-report-good" : "frame3d-report-bad"}>{uc <= 1 ? "voldoet" : "voldoet niet"}</td>
                  </tr>;
                })}
              </tbody></table>
              {checks.notes.map((note) => <p key={note} className="frame3d-report-note">{note}</p>)}
            </>}
            {!checksRunning && !checksError && checks && checks.results.length === 0 && <p>Geen toetsbaar stalen catalogusprofiel aanwezig.</p>}
            {checks && checks.skipped.length > 0 && <details>
              <summary>{checks.skipped.length} niet getoetste sta{checks.skipped.length === 1 ? "af" : "ven"}</summary>
              <ul>{checks.skipped.map((item) => <li key={item.beamId}>Staaf {item.beamId}: {item.reason}</li>)}</ul>
            </details>}
          </section>

          <section>
            <h2>EN 1992 betontoetsing</h2>
            {checksRunning && <p>De normtoetsing wordt uitgevoerd…</p>}
            {checksError && <p className="frame3d-report-bad">Normtoetsing: {checksError}</p>}
            {!checksRunning && !checksError && concreteChecks && concreteChecks.results.length > 0 && <>
              <table className="frame3d-report-wide"><thead><tr>
                <th>Staaf</th><th>Doorsnede</th><th>Beton</th><th>Wapening</th><th>UC UGT</th><th>Maatgevend</th><th>Status</th>
              </tr></thead><tbody>
                {concreteChecks.results.map((check) => {
                  const governing = check.checks.find((item) => item.id === check.governing_check_id);
                  const incompleteOutsideDetailing = check.niet_uitgevoerd.some((item) => !item.detaillering);
                  return <tr key={check.beam_id}>
                    <td>{check.beam_id}</td><td>{check.section_name}</td><td>{check.concrete_class}</td><td>{check.reinforcement_summary}</td>
                    <td>{number(check.uc_max)}</td><td>{governing?.kind.data.title ?? check.governing_check_id}</td>
                    <td className={check.status === "NotOk" ? "frame3d-report-bad" : incompleteOutsideDetailing || check.status === "NotApplicable" ? "frame3d-report-note" : "frame3d-report-good"}>
                      {check.status === "NotOk" ? "voldoet niet" : incompleteOutsideDetailing || check.status === "NotApplicable" ? "UGT voldoet · overige open" : "voldoet"}
                    </td>
                  </tr>;
                })}
              </tbody></table>
              <h3>Maatgevende deeltoetsen per betonstaaf</h3>
              <table className="frame3d-report-wide frame3d-report-checks"><thead><tr>
                <th>Staaf</th><th>Toets</th><th>Artikel</th><th>UC</th><th>Status</th>
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
                    <td className={check.kind.data.status === "Ok" ? "frame3d-report-good" : check.kind.data.status === "NotOk" ? "frame3d-report-bad" : "frame3d-report-note"}>
                      {check.kind.data.status === "Ok" ? "voldoet" : check.kind.data.status === "NotOk" ? "voldoet niet" : "n.v.t."}
                    </td>
                  </tr>);
                })}
              </tbody></table>
              {concreteChecks.notes.map((note) => <p key={note} className="frame3d-report-note">{note}</p>)}
              {concreteChecks.results.some((check) => check.niet_uitgevoerd.length > 0) && <details>
                <summary>Niet uitgevoerde betoncontroles</summary>
                <ul>{concreteChecks.results.flatMap((check) => check.niet_uitgevoerd.map((item, index) => {
                  const detail = check.checks.find((candidate) => candidate.id === item.check_id);
                  return <li key={`${check.beam_id}-${index}`}>Staaf {check.beam_id}: {item.titel}{detail?.kind.data.notes.length ? ` — ${detail.kind.data.notes.join(" ")}` : ""}</li>;
                }))}</ul>
              </details>}
            </>}
            {!checksRunning && !checksError && concreteChecks && concreteChecks.results.length === 0 && <p>Geen betonstaaf met geldige doorsnede en wapeningskorf aanwezig.</p>}
            {concreteChecks && concreteChecks.skipped.length > 0 && <details>
              <summary>{concreteChecks.skipped.length} niet getoetste betonsta{concreteChecks.skipped.length === 1 ? "af" : "ven"}</summary>
              <ul>{concreteChecks.skipped.map((item) => <li key={item.beamId}>Staaf {item.beamId}: {item.reason}</li>)}</ul>
            </details>}
          </section>

          <section>
            <h2>Staafkrachten</h2>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Staaf</th><th>L (m)</th>{(result.analysis === "material" || result.analysis === "combined") && <th>E effectief (MPa)</th>}
              <th>|N|max (kN)</th><th>|Vy|max (kN)</th><th>|Vz|max (kN)</th><th>|T|max (kNm)</th><th>|My|max (kNm)</th><th>|Mz|max (kNm)</th>
            </tr></thead><tbody>
              {result.memberForces.map((member) => <tr key={member.memberId}>
                <td>{member.memberId}</td><td>{number(member.lengthM)}</td>
                {(result.analysis === "material" || result.analysis === "combined") && <td>{member.effectiveEMpa === undefined ? "—" : number(member.effectiveEMpa, 0)}</td>}
                <td>{number(diagramMaximum(result, "axial", member.memberId, Math.max(Math.abs(member.nStartKn), Math.abs(member.nEndKn))))}</td>
                <td>{number(diagramMaximum(result, "shearY", member.memberId, Math.max(Math.abs(member.vyStartKn), Math.abs(member.vyEndKn))))}</td>
                <td>{number(diagramMaximum(result, "shearZ", member.memberId, Math.max(Math.abs(member.vzStartKn), Math.abs(member.vzEndKn))))}</td>
                <td>{number(diagramMaximum(result, "torsion", member.memberId, Math.max(Math.abs(member.torsionStartKnm), Math.abs(member.torsionEndKnm))))}</td>
                <td>{number(diagramMaximum(result, "momentY", member.memberId, Math.max(Math.abs(member.myStartKnm), Math.abs(member.myEndKnm))))}</td>
                <td>{number(diagramMaximum(result, "momentZ", member.memberId, Math.max(Math.abs(member.mzStartKnm), Math.abs(member.mzEndKnm))))}</td>
              </tr>)}
            </tbody></table>
          </section>

          {result.memberForces.some((member) => member.axialHistory) && <section>
            <h2>Axiale materiaalgeschiedenis</h2>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Staaf</th><th>Plastische rek</th><th>Equiv. plastische rek</th><th>Trekschade</th><th>E tangent axiaal (MPa)</th>
            </tr></thead><tbody>
              {result.memberForces.filter((member) => member.axialHistory).map((member) => <tr key={member.memberId}>
                <td>{member.memberId}</td><td>{number(member.axialHistory!.plasticStrain, 6)}</td>
                <td>{number(member.axialHistory!.equivalentPlasticStrain, 6)}</td>
                <td>{number(member.axialHistory!.tensileDamage, 4)}</td><td>{number(member.axialHistory!.tangentEMpa, 0)}</td>
              </tr>)}
            </tbody></table>
            <p className="frame3d-report-note">De axiale materiaaltoestand wordt per staaf bijgehouden.</p>
          </section>}

          {result.memberForces.some((member) => member.sectionHistory) && <section>
            <h2>Doorsnedegeschiedenis</h2>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Staaf</th><th>Max. plastische rek</th><th>Max. equivalente plastische rek</th><th>Max. trekschade</th>
            </tr></thead><tbody>
              {result.memberForces.filter((member) => member.sectionHistory).map((member) => <tr key={member.memberId}>
                <td>{member.memberId}</td>
                <td>{number(member.sectionHistory!.maximumAbsPlasticStrain, 6)}</td>
                <td>{number(member.sectionHistory!.maximumEquivalentPlasticStrain, 6)}</td>
                <td>{number(member.sectionHistory!.maximumTensileDamage, 4)}</td>
              </tr>)}
            </tbody></table>
            <p className="frame3d-report-note">De vezeltoestand wordt over beide lokale buigassen geïntegreerd. Momentreleases voldoen in FNL aan nul eindmoment met teruggevonden staafrotaties. Eindveren gebruiken de bestaande FNL-buigroute.</p>
          </section>}

          <section>
            <h2>Oplegreacties</h2>
            <table className="frame3d-report-wide"><thead><tr><th>Knoop</th><th>Fx</th><th>Fy</th><th>Fz</th><th>Mx</th><th>My</th><th>Mz</th></tr></thead><tbody>
              {result.reactions.map((reaction) => <tr key={reaction.nodeId}>
                <td>{reaction.nodeId}</td><td>{signed(reaction.fx)}</td><td>{signed(reaction.fy)}</td><td>{signed(reaction.fz)}</td>
                <td>{signed(reaction.mx)}</td><td>{signed(reaction.my)}</td><td>{signed(reaction.mz)}</td>
              </tr>)}
            </tbody></table>
            <p className="frame3d-report-note">Krachten in kN; momenten in kNm. Lokale staafkrachten volgen de lokale staafassen.</p>
          </section>

          {result.diagnostics.length > 0 && <section>
            <h2>Diagnostiek</h2>
            <ul>{result.diagnostics.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>
          </section>}
        </>}
      </article>
    </div>
  );
}
