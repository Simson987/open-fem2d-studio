import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ProfielKiezer from "../fem/ProfielKiezer";
import Frame3DNodeConditions, { type Frame3DLoadEditorRequest, type Frame3DSpringEditorRequest } from "./Frame3DNodeConditions";
import Frame3DMemberLoads from "./Frame3DMemberLoads";
import Frame3DNonlinearLawEditor from "./Frame3DNonlinearLawEditor";
import Frame3DPlateReinforcementEditor from "./Frame3DPlateReinforcementEditor";
import type { Frame3DSelection } from "./frame3dSelection";
import { removeFrame3DSurfaceLoad, setFrame3DBeamNodes, updateFrame3DPlate, updateFrame3DSurfaceLoad, type Frame3DModel } from "./frame3dModel";
import type { Frame3DAnalysisKind, Frame3DSolveResult } from "./frame3dSolver";
import {
  checkUc,
  frame3DGoverningUlsCheck,
  frame3DUlsUc,
  type Frame3DSteelChecks,
} from "./frame3dSteelCheck";
import { matchSupportedConcreteClass } from "../../lib/betonCheckBuilder";
import { CONCRETE_E_CM, eVanMateriaal } from "../../lib/sectionResolver";
import type { Frame3DConcreteChecks } from "./frame3dConcreteCheck";
import KolomVelden from "../beton/KolomVelden";
import "../fem/FemProperties.css";
import "./Frame3DProperties.css";

interface Props {
  model: Frame3DModel;
  analysis: Frame3DAnalysisKind;
  selection: Frame3DSelection;
  onChange: (model: Frame3DModel) => void;
  result: Frame3DSolveResult | null;
  checks?: Frame3DSteelChecks | null;
  concreteChecks?: Frame3DConcreteChecks | null;
  checksRunning?: boolean;
  checksError?: string | null;
  loadEditorRequest?: Frame3DLoadEditorRequest | null;
  springEditorRequest?: Frame3DSpringEditorRequest | null;
  memberLoadEditorRequest?: number;
  memberPointLoadEditorRequest?: number;
  thermalLoadEditorRequest?: number;
  activeLoadCaseId?: number;
  normFocus?: { beamId: number; serial: number } | null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fem-prop-row"><span className="fem-prop-label">{label}</span><span className="fem-prop-value">{children}</span></div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="fem-prop-section"><div className="fem-prop-section-title">{title}</div>{children}</section>;
}

const value = (number: number, digits = 3) => Number.isFinite(number) ? number.toFixed(digits) : "—";

export default function Frame3DProperties({
  model, analysis, selection, onChange, result, checks, concreteChecks, checksRunning, checksError,
  loadEditorRequest, springEditorRequest, memberLoadEditorRequest, memberPointLoadEditorRequest,
  thermalLoadEditorRequest, activeLoadCaseId = 1, normFocus,
}: Props) {
  const { t } = useTranslation("ribbon");
  const [tab, setTab] = useState<"general" | "results" | "norm">("general");
  const [profileOpen, setProfileOpen] = useState(false);
  const nodalLoad = selection?.type === "nodalLoad" ? model.loads?.find((item) => item.id === selection.id) : undefined;
  const memberLoad = selection?.type === "memberLoad" ? model.memberLoads?.find((item) => item.id === selection.id) : undefined;
  const memberPointLoad = selection?.type === "memberPointLoad" ? model.memberPointLoads?.find((item) => item.id === selection.id) : undefined;
  const thermalLoad = selection?.type === "thermalLoad" ? model.thermalLoads?.find((item) => item.id === selection.id) : undefined;
  const surfaceLoad = selection?.type === "surfaceLoad" ? model.surfaceLoads?.find((item) => item.id === selection.id) : undefined;
  const selectedBeamLoad = memberLoad ?? memberPointLoad ?? thermalLoad;
  const node = selection?.type === "node"
    ? model.nodes.find((item) => item.id === selection.id)
    : nodalLoad ? model.nodes.find((item) => item.id === nodalLoad.nodeId) : undefined;
  const beam = selection?.type === "beam"
    ? model.beams.find((item) => item.id === selection.id)
    : selectedBeamLoad ? model.beams.find((item) => item.id === selectedBeamLoad.beamId) : undefined;
  const plate = selection?.type === "plate"
    ? model.plates?.find((item) => item.id === selection.id)
    : surfaceLoad ? model.plates?.find((item) => item.id === surfaceLoad.plateId) : undefined;
  const plateResult = plate && result?.plateBending?.plateId === plate.id ? result.plateBending : undefined;
  const [coordinates, setCoordinates] = useState({ x: "", y: "", z: "" });
  const [rollDegrees, setRollDegrees] = useState("0");
  const [loadPathText, setLoadPathText] = useState("");
  const [loadPathError, setLoadPathError] = useState("");
  const [plateCurveText, setPlateCurveText] = useState("");
  const [plateCurveError, setPlateCurveError] = useState("");

  useEffect(() => {
    setLoadPathText(model.materialLoadPath?.join(", ") ?? "");
    setLoadPathError("");
  }, [model.materialLoadPath]);

  useEffect(() => {
    setPlateCurveText(plate?.modulusCurve?.map((point) => `${point.strain}:${point.eMpa}`).join("; ") ?? "");
    setPlateCurveError("");
  }, [plate?.id, plate?.modulusCurve]);

  useEffect(() => {
    if (node) setCoordinates({ x: String(node.x), y: String(node.y), z: String(node.z) });
  }, [node?.id, node?.x, node?.y, node?.z]);
  useEffect(() => {
    if (beam) setRollDegrees(String((beam.rollAngleRad ?? 0) * 180 / Math.PI));
  }, [beam?.id, beam?.rollAngleRad]);
  const selectionId = selection && selection.type !== "multi" ? selection.id : undefined;
  useEffect(() => { setTab("general"); }, [selection?.type, selectionId]);
  useEffect(() => {
    if (normFocus && selection?.type === "beam" && selection.id === normFocus.beamId) setTab("norm");
  }, [normFocus?.serial, selection?.type, selectionId]);

  const memberForces = beam ? result?.memberForces.find((item) => item.memberId === beam.id) : undefined;
  const buckling = beam && result?.buckling.status === "available"
    ? result.buckling.members.find((item) => item.memberId === beam.id)
    : undefined;
  const displacement = node ? result?.displacements.find((item) => item.nodeId === node.id) : undefined;
  const reaction = node ? result?.reactions.find((item) => item.nodeId === node.id) : undefined;
  const beamCheck = beam ? checks?.results.find((item) => item.beam_id === beam.id) : undefined;
  const checkSkip = beam ? checks?.skipped.find((item) => item.beamId === beam.id) : undefined;
  const concreteCheck = beam ? concreteChecks?.results.find((item) => item.beam_id === beam.id) : undefined;
  const concreteSkip = beam ? concreteChecks?.skipped.find((item) => item.beamId === beam.id) : undefined;
  const concreteGoverning = concreteCheck?.checks.find((item) => item.id === concreteCheck.governing_check_id);
  const beamIsConcrete = !!beam && matchSupportedConcreteClass(beam.material) !== null;
  const governingCheck = beamCheck ? frame3DGoverningUlsCheck(beamCheck) : undefined;
  const beamGeometry = useMemo(() => {
    if (!beam) return null;
    const start = model.nodes.find((item) => item.id === beam.startNodeId);
    const end = model.nodes.find((item) => item.id === beam.endNodeId);
    if (!start || !end) return null;
    return {
      start,
      end,
      length: Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z),
    };
  }, [beam, model.nodes]);
  const predominantlyVertical = !!beamGeometry && beamGeometry.length > 0
    && Math.abs(beamGeometry.end.z - beamGeometry.start.z) / beamGeometry.length >= Math.sin(75 * Math.PI / 180);

  if (selection?.type === "multi") {
    return <div className="fem-properties"><div className="fem-prop-selection">
      <span className="fem-prop-selection-label">{t("frame3d.selection", "Selectie")}</span>
      <span className="fem-prop-selection-value">{selection.nodeIds.length} knopen · {selection.beamIds.length} staven · {selection.plateIds?.length ?? 0} platen</span>
    </div><div className="fem-prop-body"><p className="fem-prop-hint">
      Gebruik Verplaatsen, Roteren, Kopiëren of Spiegelen op de volledige selectie.
    </p></div></div>;
  }

  if (!selection || (!node && !beam && !plate)) {
    const applyLoadPath = () => {
      const pieces = loadPathText.trim().split(/[;,\s]+/);
      const factors = pieces.map(Number);
      if (!loadPathText.trim() || factors.length > 100 || factors.some((factor) => !Number.isFinite(factor))) {
        setLoadPathError("Voer 1–100 eindige getallen in, gescheiden door komma's. Voorbeeld: 1, 0, 0.5");
        return;
      }
      setLoadPathError("");
      onChange({ ...model, materialLoadPath: factors });
    };
    return <div className="fem-properties"><div className="fem-prop-body">
      <p className="fem-prop-hint">{t("frame3d.selectForProperties", "Selecteer een 3D-knoop, staaf, plaat of belasting om de eigenschappen te bekijken.")}</p>
      <Section title="FNL-lastpad · Rust 3D">
        <p className="fem-prop-hint">Absolute lastfactoren voor belastingen en opgelegde verplaatsingen. Het resultaat hoort bij de laatste factor. Gebruik een punt als decimaalteken. Staven bewaren axiale geschiedenis; platen bewaren maximale vezelrek per element.</p>
        <Row label="Factoren"><input className="fem-prop-input" type="text" aria-label="FNL-lastfactoren" placeholder="1, 0, 0.5"
          value={loadPathText} onChange={(event) => setLoadPathText(event.target.value)} /></Row>
        <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" type="button" onClick={applyLoadPath}>Lastpad toepassen</button></div>
        <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" type="button" onClick={() => { setLoadPathText(""); setLoadPathError(""); onChange({ ...model, materialLoadPath: undefined }); }}>Lastpad wissen</button></div>
        {loadPathError && <p className="frame3d-check-not-ok" role="alert">{loadPathError}</p>}
        {analysis !== "material" && <p className="fem-prop-hint">Kies FNL-analyse om dit lastpad te gebruiken.</p>}
      </Section>
    </div></div>;
  }

  const applyCoordinates = () => {
    if (!node) return;
    const next = { x: Number(coordinates.x), y: Number(coordinates.y), z: Number(coordinates.z) };
    if (!Object.values(next).every(Number.isFinite)) return;
    const nodes = model.nodes.map((item) => item.id === node.id ? { ...item, ...next } : item);
    const byId = new Map(nodes.map((item) => [item.id, item]));
    if (model.beams.some((item) => {
      const a = byId.get(item.startNodeId), b = byId.get(item.endNodeId);
      return a && b && a.x === b.x && a.y === b.y && a.z === b.z;
    })) return;
    onChange({ ...model, nodes });
  };

  const updateBeam = (patch: Partial<NonNullable<typeof beam>>) => {
    if (!beam) return;
    onChange({ ...model, beams: model.beams.map((item) => item.id === beam.id ? { ...item, ...patch } : item) });
  };

  const applyRoll = () => {
    const degrees = Number(rollDegrees);
    if (!Number.isFinite(degrees)) {
      setRollDegrees(String((beam?.rollAngleRad ?? 0) * 180 / Math.PI));
      return;
    }
    updateBeam({ rollAngleRad: degrees * Math.PI / 180 });
  };

  const flipLocalAxes = () => {
    if (!beam) return;
    const beamId = beam.id;
    onChange({
      ...model,
      beams: model.beams.map((item) => item.id === beamId
        ? { ...item, rollAngleRad: ((item.rollAngleRad ?? 0) + Math.PI) % (2 * Math.PI) }
        : item),
      // De lokale belastingcomponenten draaien mee, zodat hun richting in het
      // wereldstelsel bij het omkeren van beide dwarsassen behouden blijft.
      memberLoads: model.memberLoads?.map((load) => load.beamId === beamId
        ? { ...load, qyStart: -load.qyStart, qyEnd: -load.qyEnd, qzStart: -load.qzStart, qzEnd: -load.qzEnd }
        : load),
      memberPointLoads: model.memberPointLoads?.map((load) => load.beamId === beamId
        ? { ...load, py: -load.py, pz: -load.pz } : load),
      thermalLoads: model.thermalLoads?.map((load) => load.beamId === beamId
        ? { ...load, deltaTGradientYK: -load.deltaTGradientYK, deltaTGradientZK: -load.deltaTGradientZK }
        : load),
    });
  };

  const selectionLabel = selection.type === "nodalLoad" ? `Knoopbelasting ${selection.id}`
    : selection.type === "memberLoad" ? `Staafbelasting ${selection.id}`
    : selection.type === "memberPointLoad" ? `Staafpuntlast ${selection.id}`
    : selection.type === "thermalLoad" ? `Temperatuurbelasting ${selection.id}`
    : selection.type === "surfaceLoad" ? `Oppervlaktebelasting ${selection.id}`
    : selection.type === "plate" ? `Plaat ${selection.id}`
    : selection.type === "node" ? t("frame3d.editNode", { id: selection.id })
    : t("frame3d.editBeam", { id: selection.id });

  return <div className="fem-properties" data-frame3d-properties={selection.id}>
    <div className="fem-prop-selection">
      <span className="fem-prop-selection-label">{t("frame3d.selection", "Selectie")}</span>
      <span className="fem-prop-selection-value">{selectionLabel}</span>
    </div>
    <div className="fem-prop-tabs">
      <button className={`fem-prop-tab${tab === "general" ? " active" : ""}`} onClick={() => setTab("general")}>{t("frame3d.general", "Algemeen")}</button>
      <button className={`fem-prop-tab${tab === "results" ? " active" : ""}`} onClick={() => setTab("results")}>{t("frame3d.results")}</button>
      {beam && <button className={`fem-prop-tab${tab === "norm" ? " active" : ""}`} onClick={() => setTab("norm")}>{beamIsConcrete ? "EN 1992" : "EN 1993"}</button>}
    </div>

    <div className="fem-prop-body" key={`${selection.type}:${selection.id}:${tab}`}>
      {tab === "general" && node && <>
        <Section title={t("frame3d.geometry", "Geometrie")}>
          <Row label="ID"><code>{node.id}</code></Row>
          {(["x", "y", "z"] as const).map((axis) => <Row key={axis} label={`${axis.toUpperCase()} (m)`}>
            <input className="fem-prop-input" type="number" step="any" value={coordinates[axis]}
              onChange={(event) => setCoordinates({ ...coordinates, [axis]: event.target.value })}
              onBlur={applyCoordinates}
              onKeyDown={(event) => { if (event.key === "Enter") { applyCoordinates(); event.currentTarget.blur(); } }} />
          </Row>)}
        </Section>
        <Frame3DNodeConditions model={model} nodeId={node.id} onChange={onChange}
          loadEditorRequest={loadEditorRequest} springEditorRequest={springEditorRequest}
          activeLoadCaseId={activeLoadCaseId}
          selectedLoadId={selection.type === "nodalLoad" ? selection.id : undefined} />
      </>}

      {tab === "general" && beam && <>
        <Section title={t("frame3d.geometry", "Geometrie")}>
          <Row label="ID"><code>{beam.id}</code></Row>
          <Row label={t("frame3d.startNode")}><select className="fem-prop-input" value={beam.startNodeId}
            onChange={(event) => onChange(setFrame3DBeamNodes(model, beam.id, Number(event.target.value), beam.endNodeId))}>
            {model.nodes.map((candidate) => <option key={candidate.id} value={candidate.id}
              disabled={candidate.id === beam.endNodeId || (
                candidate.x === beamGeometry?.end.x && candidate.y === beamGeometry?.end.y && candidate.z === beamGeometry?.end.z
              )}>K{candidate.id} ({candidate.x}, {candidate.y}, {candidate.z})</option>)}
          </select></Row>
          <Row label={t("frame3d.endNode")}><select className="fem-prop-input" value={beam.endNodeId}
            onChange={(event) => onChange(setFrame3DBeamNodes(model, beam.id, beam.startNodeId, Number(event.target.value)))}>
            {model.nodes.map((candidate) => <option key={candidate.id} value={candidate.id}
              disabled={candidate.id === beam.startNodeId || (
                candidate.x === beamGeometry?.start.x && candidate.y === beamGeometry?.start.y && candidate.z === beamGeometry?.start.z
              )}>K{candidate.id} ({candidate.x}, {candidate.y}, {candidate.z})</option>)}
          </select></Row>
          <Row label={t("frame3d.length", "Lengte")}><code>{value(beamGeometry?.length ?? 0)} m</code></Row>
        </Section>
        <Section title={t("frame3d.crossSection", "Profiel en materiaal")}>
          <Row label={t("frame3d.profile")}><code>{beam.profileName || "—"} — {beam.material || "—"}</code></Row>
          <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" onClick={() => setProfileOpen(true)}>{t("frame3d.chooseProfile", "Profiel kiezen…")}</button></div>
          {profileOpen && <ProfielKiezer
            open
            onClose={() => setProfileOpen(false)}
            huidig={{ material: beam.material ?? "S235", profile: beam.profileName ?? "IPE 200" }}
            huidigBeton={{
              ...(beam.checkConfig?.betonKorf ? { korf: beam.checkConfig.betonKorf } : {}),
              ...(beam.checkConfig?.betonMilieuklasse ? { milieuklasse: beam.checkConfig.betonMilieuklasse } : {}),
              ...(beam.checkConfig?.betonConstructieklasse ? { constructieklasse: beam.checkConfig.betonConstructieklasse } : {}),
            }}
            onApply={(choice) => {
              onChange({ ...model, beams: model.beams.map((item) => item.id === beam.id
                ? {
                    ...item,
                    material: choice.material,
                    profileName: choice.profile,
                    ...(choice.beton ? {
                      checkConfig: {
                        ...(item.checkConfig ?? {}),
                        betonKorf: choice.beton.korf,
                        betonMilieuklasse: choice.beton.milieuklasse ?? undefined,
                        betonConstructieklasse: choice.beton.constructieklasse ?? undefined,
                      },
                    } : {}),
                  }
                : item) });
              setProfileOpen(false);
            }}
          />}
          <Frame3DNonlinearLawEditor key={beam.id} law={beam.nonlinearLaw}
            onApply={(law) => onChange({ ...model, beams: model.beams.map((item) => item.id === beam.id
              ? { ...item, nonlinearLaw: law } : item) })} />
        </Section>
        <Section title={t("frame3d.localAxesAndReleases", "Lokale assen en eindscharnieren")}>
          <Row label={t("frame3d.rollAngle", "Profielrotatie")}>
            <span className="frame3d-roll-input"><input className="fem-prop-input" type="number" step="any"
              value={rollDegrees} onChange={(event) => setRollDegrees(event.target.value)}
              onBlur={applyRoll} onKeyDown={(event) => { if (event.key === "Enter") { applyRoll(); event.currentTarget.blur(); } }} /> °</span>
          </Row>
          <div className="fem-prop-kiezer-row"><button type="button" className="fem-prop-kiezer-btn" onClick={flipLocalAxes}>Keer lokale y/z-assen 180° om</button></div>
          <p className="fem-prop-hint">Scharnieren geven het moment om de lokale as aan dat het staafeinde niet overdraagt.</p>
          <div className="frame3d-release-grid">
            {([
              ["myStart", "My begin"], ["myEnd", "My eind"],
              ["mzStart", "Mz begin"], ["mzEnd", "Mz eind"],
              ["torsionStart", "T begin"], ["torsionEnd", "T eind"],
            ] as const).map(([key, label]) => <label key={key}>
              <input type="checkbox" checked={beam.releases?.[key] ?? false} onChange={(event) => updateBeam({
                releases: {
                  myStart: beam.releases?.myStart ?? false,
                  myEnd: beam.releases?.myEnd ?? false,
                  mzStart: beam.releases?.mzStart ?? false,
                  mzEnd: beam.releases?.mzEnd ?? false,
                  torsionStart: beam.releases?.torsionStart ?? false,
                  torsionEnd: beam.releases?.torsionEnd ?? false,
                  [key]: event.target.checked,
                },
              })} />
              <span>{label}</span>
            </label>)}
          </div>
        </Section>
        <Frame3DMemberLoads model={model} beamId={beam.id} lengthM={beamGeometry?.length ?? 0}
          onChange={onChange} editorRequest={memberLoadEditorRequest} pointEditorRequest={memberPointLoadEditorRequest}
          thermalEditorRequest={thermalLoadEditorRequest}
          selectedLoad={selection.type === "memberLoad" || selection.type === "memberPointLoad" || selection.type === "thermalLoad"
            ? { kind: selection.type, id: selection.id }
            : undefined}
          activeLoadCaseId={activeLoadCaseId} />
      </>}

      {tab === "general" && plate && <>
        <Section title="Plaat­geometrie">
          <Row label="ID"><code>{plate.id}</code></Row>
          <Row label={plate.boundary ? "Contourknopen" : "Hoekknopen"}><code>{plate.nodeIds.map((id) => `K${id}`).join(" · ")}</code></Row>
          {plate.boundary && <Row label="Randsegmenten"><code>{plate.boundary.length} · {plate.boundary.filter((segment) => segment.kind === "arc").length} boog</code></Row>}
          {(plate.openings ?? []).some((opening) => opening.boundary?.some((segment) => segment.kind === "arc")) &&
            <Row label="Bogen in openingen"><code>{(plate.openings ?? []).reduce((count, opening) =>
              count + (opening.boundary?.filter((segment) => segment.kind === "arc").length ?? 0), 0)}</code></Row>}
          <Row label="Dikte (m)"><input className="fem-prop-input" type="number" min="0.001" step="0.01"
            defaultValue={plate.thicknessM} key={`thickness-${plate.id}-${plate.thicknessM}`}
            onBlur={(event) => { const next = Number(event.currentTarget.value); if (next > 0) onChange(updateFrame3DPlate(model, plate.id, { thicknessM: next })); }} /></Row>
          <Row label="Randstraal (m)"><input className="fem-prop-input" type="number" min="0" step="0.01"
            defaultValue={plate.cornerRadiusM ?? 0} key={`radius-${plate.id}-${plate.cornerRadiusM ?? 0}`}
            onBlur={(event) => { const next = Number(event.currentTarget.value); if (next >= 0) onChange(updateFrame3DPlate(model, plate.id, { cornerRadiusM: next })); }} /></Row>
          <Row label="Materiaal"><input className="fem-prop-input" defaultValue={plate.material ?? "C30/37"}
            key={`material-${plate.id}-${plate.material}`}
            onBlur={(event) => onChange(updateFrame3DPlate(model, plate.id, { material: event.currentTarget.value.trim() || "C30/37" }))} /></Row>
          <Row label="Openingen"><code>{plate.openings?.length ?? 0}</code></Row>
        </Section>
        {plate.nodeIds.length === 4 && <Section title="Plaat­randen · Rust Q4">
          <p className="fem-prop-hint">Voor de rechthoekige Rust-plaatroute: rand 1–4 volgt de contourknopen. Scharnierend zet de zakking op nul; ingeklemd zet ook beide plaatrotaties vast. De oplegging geldt voor alle roosterknopen langs die rand.</p>
          <Row label="Max. celmaat (m)"><input className="fem-prop-input" type="number" min="0.001" step="0.05"
            aria-label="Maximale plaatcelmaat" placeholder="automatisch"
            defaultValue={plate.maxCellSizeM ?? ""} key={`cell-${plate.id}-${plate.maxCellSizeM ?? "auto"}`}
            onBlur={(event) => { const text = event.currentTarget.value.trim(); const next = text ? Number(text) : undefined;
              if (next === undefined || next > 0) onChange(updateFrame3DPlate(model, plate.id, { maxCellSizeM: next })); }} /></Row>
          {plate.nodeIds.map((startId, index) => <Row key={`${plate.id}-edge-${index}`} label={`Rand ${index + 1}: K${startId}–K${plate.nodeIds[(index + 1) % 4]}`}>
            <select className="fem-prop-input" aria-label={`Plaat rand ${index + 1} oplegging`}
              value={plate.edgeSupports?.[index] ?? "free"} onChange={(event) => {
                const next = [...(plate.edgeSupports ?? ["free", "free", "free", "free"])] as NonNullable<typeof plate.edgeSupports>;
                next[index] = event.target.value as typeof next[number];
                onChange(updateFrame3DPlate(model, plate.id, { edgeSupports: next }));
              }}>
              <option value="free">Vrij</option><option value="simplySupported">Scharnierend</option><option value="clamped">Ingeklemd</option>
            </select></Row>)}
        </Section>}
        <Section title="FNL-plaat · secant-E(rek)">
          <p className="fem-prop-hint">Geef 2–100 punten als rek:E(MPa), gescheiden door puntkomma's. Begin bij 0 met de E van het materiaal
            {Number.isFinite(eVanMateriaal(plate.material ?? "").E) ? ` (${eVanMateriaal(plate.material ?? "").E} MPa)` : ""}; rek moet stijgen en E mag niet stijgen. Deze omhulling bewaart de grootste vezelrek en modelleert geen plastische doorsnede of expliciete scheurwet.</p>
          <Row label="E-rekcurve"><textarea className="fem-prop-input" aria-label="FNL E-rekcurve plaat" rows={3}
            placeholder="0:33000; 0.0001:20000; 0.0005:5000"
            value={plateCurveText} onChange={(event) => setPlateCurveText(event.target.value)} /></Row>
          <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" type="button" onClick={() => {
            try {
              const points = plateCurveText.trim().split(/[;\n]+/).map((piece) => {
                const parts = piece.trim().split(":");
                if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) throw new Error("Gebruik per punt rek:E, bijvoorbeeld 0.0001:20000.");
                return { strain: Number(parts[0].trim()), eMpa: Number(parts[1].trim()) };
              });
              onChange(updateFrame3DPlate(model, plate.id, { modulusCurve: points }));
              setPlateCurveError("");
            } catch (error) { setPlateCurveError(error instanceof Error ? error.message : String(error)); }
          }}>E-rekcurve toepassen</button>
            <button className="fem-prop-kiezer-btn" type="button" onClick={() => {
              onChange(updateFrame3DPlate(model, plate.id, { modulusCurve: undefined }));
              setPlateCurveText(""); setPlateCurveError("");
            }}>Wissen</button></div>
          {plateCurveError && <p className="frame3d-check-not-ok" role="alert">{plateCurveError}</p>}
          {analysis !== "material" && <p className="fem-prop-hint">Kies FNL-analyse om de E-rekcurve te gebruiken.</p>}
        </Section>
        {plate.material && plate.material in CONCRETE_E_CM
          && <Frame3DPlateReinforcementEditor model={model} plate={plate} onChange={onChange} />}
        <Section title="Oppervlaktebelastingen">
          {(model.surfaceLoads ?? []).filter((load) => load.plateId === plate.id).length === 0 && <p className="fem-prop-hint">Selecteer de plaat en kies Oppervlaktelast in het lint.</p>}
          {surfaceLoad && <>
            {(["qx", "qy", "qz"] as const).map((axis) => <Row key={axis} label={`${axis} (kN/m²)`}>
              <input className="fem-prop-input" type="number" step="any" defaultValue={surfaceLoad[axis]}
                key={`${surfaceLoad.id}-${axis}-${surfaceLoad[axis]}`}
                onBlur={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChange(updateFrame3DSurfaceLoad(model, surfaceLoad.id, { qx: surfaceLoad.qx, qy: surfaceLoad.qy, qz: surfaceLoad.qz, [axis]: next }));
                }} />
            </Row>)}
            <button className="frame3d-delete" type="button" onClick={() => onChange(removeFrame3DSurfaceLoad(model, surfaceLoad.id))}>Oppervlaktebelasting verwijderen</button>
          </>}
        </Section>
      </>}

      {tab === "results" && <>
        {!result && <p className="fem-prop-hint">{t("frame3d.readyToCalculate")}</p>}
        {plateResult && <Section title={`Buigplaat ${plateResult.plateId}`}>
          <Row label="Rooster"><code>{plateResult.nodes.length} knopen · {plateResult.elements.length} Q4-elementen</code></Row>
          <Row label="Reactieknooppunten"><code>{plateResult.reactions.length}</code></Row>
          <Row label="ΣR normaal"><code>{value(plateResult.reactions.reduce((sum, reaction) => sum
            + reaction.fx * plateResult.basis.normal[0] + reaction.fy * plateResult.basis.normal[1]
            + reaction.fz * plateResult.basis.normal[2], 0))} kN</code></Row>
          <Row label="Max. |w|"><code>{value(Math.max(...plateResult.nodes.map((node) => Math.abs(node.wM))) * 1000, 5)} mm</code></Row>
          <Row label="Max. |M|"><code>{value(Math.max(...plateResult.elements.flatMap((element) => element.momentKnmPerM.map(Math.abs))))} kNm/m</code></Row>
          <Row label="Max. |V|"><code>{value(Math.max(...plateResult.elements.flatMap((element) => element.shearKnPerM.map(Math.abs))))} kN/m</code></Row>
          <Row label="Min. Eeff"><code>{value(Math.min(...plateResult.elements.map((element) => element.effectiveEMpa)))} MPa</code></Row>
          {result?.materialIterations !== undefined && <Row label="FNL-iteraties"><code>{result.materialIterations}</code></Row>}
          {plateResult.elements.some((element) => element.reinforcement?.shear) && <Row label="Max. Asw,req"><code>{value(Math.max(...plateResult.elements.map((element) =>
            element.reinforcement?.shear?.check.requiredShearMm2PerM2 ?? 0)), 1)} mm²/m²</code></Row>}
          {plateResult.elements.some((element) => element.reinforcement?.crack) && <Row label="Max. wk"><code>{value(Math.max(...plateResult.elements.flatMap((element) =>
            element.reinforcement?.crack?.map((entry) => entry.check.characteristicWidthMm ?? 0) ?? [])), 3)} mm</code></Row>}
        </Section>}
        {node && displacement && <Section title={t("frame3d.displacements", "Knoopverplaatsingen")}>
          <Row label="Ux"><code>{value(displacement.ux * 1000)} mm</code></Row><Row label="Uy"><code>{value(displacement.uy * 1000)} mm</code></Row><Row label="Uz"><code>{value(displacement.uz * 1000)} mm</code></Row>
          <Row label="Rx"><code>{value(displacement.rx, 6)} rad</code></Row><Row label="Ry"><code>{value(displacement.ry, 6)} rad</code></Row><Row label="Rz"><code>{value(displacement.rz, 6)} rad</code></Row>
        </Section>}
        {node && reaction && <Section title={t("frame3d.reactions", "Oplegreacties")}>
          <Row label="Fx"><code>{value(reaction.fx)} kN</code></Row><Row label="Fy"><code>{value(reaction.fy)} kN</code></Row><Row label="Fz"><code>{value(reaction.fz)} kN</code></Row>
          <Row label="Mx"><code>{value(reaction.mx)} kNm</code></Row><Row label="My"><code>{value(reaction.my)} kNm</code></Row><Row label="Mz"><code>{value(reaction.mz)} kNm</code></Row>
        </Section>}
        {beam && memberForces && <Section title={t("frame3d.memberForces", "Staafkrachten begin / eind")}>
          {result?.analysis === "material" && memberForces.effectiveEMpa !== undefined
            && <Row label="E effectief"><code>{value(memberForces.effectiveEMpa, 0)} MPa</code></Row>}
          {memberForces.axialHistory && <>
            <Row label="Plastische rek"><code>{value(memberForces.axialHistory.plasticStrain, 6)}</code></Row>
            <Row label="Equiv. plastische rek"><code>{value(memberForces.axialHistory.equivalentPlasticStrain, 6)}</code></Row>
            <Row label="Trekschade"><code>{value(memberForces.axialHistory.tensileDamage, 4)}</code></Row>
            <Row label="E tangent axiaal"><code>{value(memberForces.axialHistory.tangentEMpa, 0)} MPa</code></Row>
          </>}
          <Row label="N"><code>{value(memberForces.nStartKn)} / {value(memberForces.nEndKn)} kN</code></Row>
          <Row label="Vy"><code>{value(memberForces.vyStartKn)} / {value(memberForces.vyEndKn)} kN</code></Row>
          <Row label="Vz"><code>{value(memberForces.vzStartKn)} / {value(memberForces.vzEndKn)} kN</code></Row>
          <Row label="T"><code>{value(memberForces.torsionStartKnm)} / {value(memberForces.torsionEndKnm)} kNm</code></Row>
          <Row label="My"><code>{value(memberForces.myStartKnm)} / {value(memberForces.myEndKnm)} kNm</code></Row>
          <Row label="Mz"><code>{value(memberForces.mzStartKnm)} / {value(memberForces.mzEndKnm)} kNm</code></Row>
        </Section>}
      </>}

      {tab === "norm" && beam && <>
        <Section title={t("frame3d.stability", "Stabiliteit")}>
          <Row label="αcr"><code>{result?.buckling.status === "available" ? value(result.buckling.modes[0]?.loadFactor ?? NaN) : "—"}</code></Row>
          <Row label="Lcr"><code>{buckling ? `${value(buckling.effectiveLengthM)} m` : "—"}</code></Row>
          <Row label="λy"><code>{buckling ? value(buckling.slendernessY) : "—"}</code></Row>
          <Row label="λz"><code>{buckling ? value(buckling.slendernessZ) : "—"}</code></Row>
        </Section>
        {beamIsConcrete && <Section title="EN 1992-1-1 §5.8 · Kolom">
          <KolomVelden
            waarde={beam.checkConfig?.betonKolom}
            onChange={(betonKolom) => onChange({
              ...model,
              beams: model.beams.map((item) => item.id === beam.id ? {
                ...item,
                checkConfig: { ...(item.checkConfig ?? {}), betonKolom },
              } : item),
            })}
            lengteMm={(beamGeometry?.length ?? 0) * 1000}
            overwegendVerticaal={predominantlyVertical}
            spatialModel
            idPrefix={`frame3d-column-${beam.id}`}
          />
        </Section>}
        {!beamIsConcrete && <Section title="EN 1993-1-1 · UGT">
          {checksRunning && <p className="fem-prop-hint">Normtoetsing wordt uitgevoerd…</p>}
          {checksError && <p className="frame3d-error" role="alert">{checksError}</p>}
          {!checksRunning && !checksError && !beamCheck && <p className="fem-prop-hint">
            {checkSkip?.reason ?? (result ? "Voor deze staaf is geen staaltoets beschikbaar." : "Bereken eerst het 3D-model.")}
          </p>}
          {beamCheck && <>
            <Row label="Status"><strong className={frame3DUlsUc(beamCheck) <= 1 ? "frame3d-check-ok" : "frame3d-check-not-ok"}>
              {frame3DUlsUc(beamCheck) <= 1 ? "voldoet" : "voldoet niet"}
            </strong></Row>
            <Row label="UC UGT"><code>{value(frame3DUlsUc(beamCheck))}</code></Row>
            <Row label="Maatgevend"><code>{governingCheck?.kind.data.title ?? "—"}</code></Row>
            <Row label="Artikel"><code>{governingCheck?.kind.data.article ?? "—"}</code></Row>
            <Row label="Klasse"><code>{beamCheck.classification}</code></Row>
            <div className="frame3d-check-list">
              {beamCheck.checks
                .filter((check) => !check.id.startsWith("deflection_") && !check.id.startsWith("sls_"))
                .filter((check) => checkUc(check) !== null)
                .sort((a, b) => (checkUc(b) ?? 0) - (checkUc(a) ?? 0))
                .slice(0, 6)
                .map((check) => <div key={check.id}>
                  <span>{check.kind.data.title}</span><code>{value(checkUc(check) ?? 0)}</code>
                </div>)}
            </div>
          </>}
        </Section>}
        {beamIsConcrete && <Section title="EN 1992-1-1 · UGT">
          {checksRunning && <p className="fem-prop-hint">Betontoetsing wordt uitgevoerd…</p>}
          {checksError && <p className="frame3d-error" role="alert">{checksError}</p>}
          {!checksRunning && !checksError && !concreteCheck && <p className="fem-prop-hint">
            {concreteSkip?.reason ?? (result ? "Voor deze staaf is geen betontoets beschikbaar." : "Bereken eerst het 3D-model.")}
          </p>}
          {concreteCheck && <>
            <Row label="Status"><strong className={concreteCheck.status === "Ok" ? "frame3d-check-ok" : "frame3d-check-not-ok"}>
              {concreteCheck.status === "Ok" ? "voldoet" : concreteCheck.status === "NotOk" ? "voldoet niet" : "onvolledig"}
            </strong></Row>
            <Row label="UC UGT"><code>{value(concreteCheck.uc_max)}</code></Row>
            <Row label="Maatgevend"><code>{concreteGoverning?.kind.data.title ?? concreteCheck.governing_check_id}</code></Row>
            <Row label="Artikel"><code>{concreteGoverning?.kind.data.article ?? "—"}</code></Row>
            <Row label="Doorsnede"><code>{concreteCheck.section_name}</code></Row>
            <Row label="Wapening"><code>{concreteCheck.reinforcement_summary}</code></Row>
            {concreteCheck.niet_uitgevoerd.length > 0 && <Row label="Niet uitgevoerd"><code>{concreteCheck.niet_uitgevoerd.length}</code></Row>}
            <div className="frame3d-check-list">
              {concreteCheck.checks
                .filter((check) => checkUc(check) !== null)
                .sort((a, b) => (checkUc(b) ?? 0) - (checkUc(a) ?? 0))
                .slice(0, 6)
                .map((check) => <div key={check.id}>
                  <span>{check.kind.data.title}</span><code>{value(checkUc(check) ?? 0)}</code>
                </div>)}
            </div>
          </>}
        </Section>}
        <p className="fem-prop-hint">{beamIsConcrete
          ? "De EN 1992-toets ontvangt alle zes lokale staafkrachten. De liggerdoorsnedetoetsen gebruiken nu My en Vz; Mz telt mee in §5.8 met volledige kolominvoer. De tweede dwarskrachtas, torsie en afzonderlijke BGT-combinaties blijven zichtbaar ongetoetst."
          : t("frame3d.normBasis", "De EN 1993-toets gebruikt alle zes lokale staafkrachten. Kniklengtes vallen terug op L en expliciete 3D-kipsteunen ontbreken nog. De eigenwaarde-knikfactor hierboven controleert apart de globale stabiliteit.")}</p>
      </>}
    </div>
  </div>;
}
