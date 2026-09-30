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
            <h1>3D raamwerkberekening</h1>
            <p>{projectName?.trim() || "Naamloos project"}</p>
          </div>
          <dl>
            <div><dt>Datum</dt><dd>{new Date().toLocaleDateString("nl-NL")}</dd></div>
            <div><dt>Model</dt><dd>{model.nodes.length} knopen · {model.beams.length} staven · {model.plates?.length ?? 0} platen</dd></div>
          </dl>
        </header>

        {!result ? <>
          <section className="frame3d-report-empty">
            <h2>Nog niet berekend</h2>
            <p>De modelinvoer hieronder kan worden afgedrukt. Tweede-orde-, knik- en staafresultaten ontbreken nog.</p>
            {(model.plates?.length ?? 0) > 0 && <p>De plaatkernel en mesh zijn nog niet aangesloten; de app rekent dit model daarom bewust niet door.</p>}
          </section>
          {(model.plates?.length ?? 0) > 0 && <section>
            <h2>Platen en openingen</h2>
            <table className="frame3d-report-wide"><thead><tr>
              <th>Plaat</th><th>Contourknopen</th><th>Rand</th><th>Dikte</th><th>Randstraal</th><th>Materiaal</th><th>Openingen</th>
            </tr></thead><tbody>
              {(model.plates ?? []).map((plate) => <tr key={plate.id}>
                <td>{plate.id}</td><td>{plate.nodeIds.join(" · ")}</td><td>{plate.boundary ? `${plate.boundary.length} segmenten (${plate.boundary.filter((segment) => segment.kind === "arc").length} boog)` : "hoekpunten"}</td><td>{number(plate.thicknessM)} m</td>
                <td>{number(plate.cornerRadiusM ?? 0)} m</td><td>{plate.material || "—"}</td>
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
          </section>}
        </> : <>
          <section>
            <h2>Samenvatting</h2>
            <div className="frame3d-report-cards">
              <div><span>Analyse</span><strong>{result.analysis === "p-delta" ? "2e orde (P-Δ)"
                : result.analysis === "material" ? "Fysisch niet-lineair" : "1e orde"}</strong></div>
              <div><span>Rekentoestand</span><strong>{activeCombinationName || activeLoadCaseName || `Geval ${activeLoadCaseId}`}</strong></div>
              <div><span>Max. verplaatsing</span><strong>{number(maxDisplacement * 1000)} mm</strong></div>
              <div><span>Convergentie</span><strong>{result.secondOrder ? `${result.secondOrder.iterations} iteratie${result.secondOrder.iterations === 1 ? "" : "s"}` : "direct"}</strong></div>
              <div><span>Eerste knikfactor αcr</span><strong>{firstMode ? number(firstMode.loadFactor) : "n.v.t."}</strong></div>
              <div><span>Evenwicht</span><strong className={equilibrium?.equilibriumOk === true && result.forceBalance?.ok !== false ? "frame3d-report-good" : "frame3d-report-bad"}>{equilibrium?.equilibriumOk === true && result.forceBalance?.ok !== false ? "akkoord" : equilibrium?.equilibriumOk === false || result.forceBalance?.ok === false ? "afwijking" : "niet geverifieerd"}</strong></div>
              {result.forceBalance && <div><span>Globale krachtensom</span><strong className={result.forceBalance.maxImbalanceKn <= result.forceBalance.toleranceKn ? "frame3d-report-good" : "frame3d-report-bad"}>{result.forceBalance.maxImbalanceKn <= result.forceBalance.toleranceKn ? "akkoord" : `${number(result.forceBalance.maxImbalanceKn, 4)} kN afwijking`}</strong></div>}
              {result.forceBalance && <div><span>Globale momentensom</span><strong className={result.forceBalance.maxMomentImbalanceKnm <= result.forceBalance.momentToleranceKnm ? "frame3d-report-good" : "frame3d-report-bad"}>{result.forceBalance.maxMomentImbalanceKnm === undefined ? "niet geverifieerd" : result.forceBalance.maxMomentImbalanceKnm <= result.forceBalance.momentToleranceKnm ? "akkoord" : `${number(result.forceBalance.maxMomentImbalanceKnm, 4)} kNm afwijking`}</strong></div>}
              <div><span>Max. versterking</span><strong>{result.secondOrder ? number(result.secondOrder.maxAmplification) : "1,000"}</strong></div>
            </div>
          </section>

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
                <th>Plaat</th><th>Contourknopen</th><th>Rand</th><th>Dikte</th><th>Randstraal</th><th>Materiaal</th><th>Openingen</th>
              </tr></thead><tbody>
                {(model.plates ?? []).map((plate) => <tr key={plate.id}>
                  <td>{plate.id}</td><td>{plate.nodeIds.join(" · ")}</td><td>{plate.boundary ? `${plate.boundary.length} segmenten (${plate.boundary.filter((segment) => segment.kind === "arc").length} boog)` : "hoekpunten"}</td><td>{number(plate.thicknessM)} m</td>
                  <td>{number(plate.cornerRadiusM ?? 0)} m</td><td>{plate.material || "—"}</td>
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
              <tr><th>{result.analysis === "material" ? "FNL-iteratie" : "Tweede orde"}</th><td>{result.secondOrder ? `${result.secondOrder.converged ? "geconvergeerd" : "niet geconvergeerd"}; ${result.secondOrder.stable ? "stabiel" : "instabiel"}` : "niet uitgevoerd"}</td></tr>
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
              <th>Staaf</th><th>L (m)</th>{result.analysis === "material" && <th>E effectief (MPa)</th>}
              <th>|N|max (kN)</th><th>|Vy|max (kN)</th><th>|Vz|max (kN)</th><th>|T|max (kNm)</th><th>|My|max (kNm)</th><th>|Mz|max (kNm)</th>
            </tr></thead><tbody>
              {result.memberForces.map((member) => <tr key={member.memberId}>
                <td>{member.memberId}</td><td>{number(member.lengthM)}</td>
                {result.analysis === "material" && <td>{member.effectiveEMpa === undefined ? "—" : number(member.effectiveEMpa, 0)}</td>}
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
