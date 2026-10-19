import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ProfielKiezer from "../fem/ProfielKiezer";
import Frame3DNodeConditions, { type Frame3DLoadEditorRequest, type Frame3DSpringEditorRequest } from "./Frame3DNodeConditions";
import Frame3DMemberLoads from "./Frame3DMemberLoads";
import Frame3DNonlinearLawEditor from "./Frame3DNonlinearLawEditor";
import Frame3DPlateReinforcementEditor from "./Frame3DPlateReinforcementEditor";
import Frame3DPlateThreeLayerEditor from "./Frame3DPlateThreeLayerEditor";
import type { Frame3DSelection } from "./frame3dSelection";
import { addFrame3DPlateEdgeLoad, addFrame3DVolumeBodyLoad, addFrame3DVolumeFaceLoad, FRAME3D_VOLUME_BACKENDS, frame3DLoadCaseId, parseFrame3DModel, removeFrame3DPlateEdgeLoad, removeFrame3DSurfaceLoad, removeFrame3DVolumeBodyLoad, removeFrame3DVolumeFaceLoad, setFrame3DBeamNodes, updateFrame3DPlate, updateFrame3DPlateEdgeLoad, updateFrame3DSurfaceLoad, updateFrame3DVolume, updateFrame3DVolumeBodyLoad, updateFrame3DVolumeFaceLoad, type Frame3DModel, type Frame3DVolume, type Frame3DVolumeBackend, type Frame3DVolumeFaceLoad, type Frame3DVolumeMaterialLaw } from "./frame3dModel";
import { frame3DVolumeFaces } from "./frame3dVolumeFaces";
import type { Frame3DAnalysisKind, Frame3DSolveResult } from "./frame3dSolver";
import {
  checkUc,
  frame3DGoverningUlsCheck,
  frame3DUlsUc,
  type Frame3DSteelChecks,
} from "./frame3dSteelCheck";
import { matchSupportedConcreteClass } from "../../lib/betonCheckBuilder";
import { CONCRETE_E_CM, TIMBER_E90_MEAN, TIMBER_G_MEAN, TIMBER_RHO_MEAN, eVanMateriaal } from "../../lib/sectionResolver";
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
  return <div className="fem-prop-row"><span className="fem-prop-row-label">{label}</span><span className="fem-prop-row-value">{children}</span></div>;
}

function Section({ title, children, badge, collapsible = false, defaultOpen = true }: {
  title: string;
  children: React.ReactNode;
  badge?: string | number;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const heading = <>{title}{badge !== undefined && <span className="frame3d-volume-section-badge">{badge}</span>}</>;
  if (collapsible) return <details className="fem-prop-section frame3d-volume-fold" open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="fem-prop-section-header">{heading}<span className="frame3d-volume-fold-chevron" aria-hidden="true" /></summary>
    <div className="fem-prop-section-body">{children}</div>
  </details>;
  return <section className="fem-prop-section"><div className="fem-prop-section-header">{heading}</div><div className="fem-prop-section-body">{children}</div></section>;
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
  const selectedVolumeId = selection?.type === "volume" ? selection.id : undefined;
  const volume = useMemo(() => selectedVolumeId === undefined ? undefined
    : model.volumes?.find((item) => item.id === selectedVolumeId), [model.volumes, selectedVolumeId]);
  const volumeStats = useMemo(() => {
    let tet4 = 0;
    let hex8 = 0;
    let position = 0;
    model.volumes?.forEach((item, index) => {
      if (item.kind === "tet4") tet4 += 1;
      else hex8 += 1;
      if (item.id === selectedVolumeId) position = index + 1;
    });
    return { total: (model.volumes ?? []).length, tet4, hex8, position };
  }, [model.volumes, selectedVolumeId]);
  const volumeBodyLoads = useMemo(() => selectedVolumeId === undefined ? []
    : (model.volumeBodyLoads ?? []).filter((load) => load.volumeId === selectedVolumeId),
  [model.volumeBodyLoads, selectedVolumeId]);
  const volumeFaceLoads = useMemo(() => selectedVolumeId === undefined ? []
    : (model.volumeFaceLoads ?? []).filter((load) => load.volumeId === selectedVolumeId),
  [model.volumeFaceLoads, selectedVolumeId]);
  const plateResult = plate && result?.plateBending?.plateId === plate.id ? result.plateBending : undefined;
  const membraneResult = plate ? result?.volume3D?.membranes?.find((item) => item.plateId === plate.id) : undefined;
  const coupledBendingResult = plate ? result?.volume3D?.bendingPlates?.find((item) => item.plateId === plate.id) : undefined;
  const volumeResult = useMemo(() => selectedVolumeId === undefined ? undefined
    : result?.volume3D?.elements.find((item) => item.elementId === selectedVolumeId),
  [result?.volume3D?.elements, selectedVolumeId]);
  const volumeSummary = useMemo(() => {
    if (!result?.volume3D) return null;
    return {
      maxDisplacementMm: result.displacements.reduce((maximum, item) =>
        Math.max(maximum, Math.hypot(item.ux, item.uy, item.uz) * 1_000), 0),
      maxVonMisesMpa: result.volume3D.elements.reduce((maximum, item) =>
        Math.max(maximum, item.vonMisesMpa), 0),
      backend: result.volume3D.backendUsed,
    };
  }, [result]);
  const [coordinates, setCoordinates] = useState({ x: "", y: "", z: "" });
  const [rollDegrees, setRollDegrees] = useState("0");
  const [loadPathText, setLoadPathText] = useState("");
  const [loadPathError, setLoadPathError] = useState("");
  const [plateCurveText, setPlateCurveText] = useState("");
  const [plateCurveError, setPlateCurveError] = useState("");
  const [volumeError, setVolumeError] = useState("");
  const [membraneError, setMembraneError] = useState("");
  const [coordinateError, setCoordinateError] = useState("");
  const [beamNodeError, setBeamNodeError] = useState("");

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
    setCoordinateError("");
  }, [node?.id, node?.x, node?.y, node?.z]);
  useEffect(() => {
    if (beam) setRollDegrees(String((beam.rollAngleRad ?? 0) * 180 / Math.PI));
  }, [beam?.id, beam?.rollAngleRad]);
  useEffect(() => { setVolumeError(""); }, [volume?.id]);
  useEffect(() => { setBeamNodeError(""); }, [beam?.id]);
  useEffect(() => { setMembraneError(""); }, [plate?.id]);
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

  if (!selection || (!node && !beam && !plate && !volume)) {
    const applyLoadPath = () => {
      const pieces = loadPathText.trim().split(/[;,\s]+/);
      const factors = pieces.map(Number);
      if (!loadPathText.trim() || factors.length > 100 || factors.some((factor) => !Number.isFinite(factor))) {
        setLoadPathError(t("frame3d.fnlLoadPathInvalid"));
        return;
      }
      setLoadPathError("");
      onChange({ ...model, materialLoadPath: factors });
    };
    return <div className={`fem-properties${volumeStats.total > 0 ? " frame3d-volume-properties" : ""}`}>
      {volumeStats.total > 0 && <div className="frame3d-volume-overview" aria-label="Volumemodel overzicht">
        <div className="frame3d-volume-overview-main">
          <span className="frame3d-volume-overview-eyebrow">VOLUMEMODEL</span>
          <strong>{volumeStats.total.toLocaleString("nl-NL")} elementen</strong>
          <span className="frame3d-volume-overview-position">{model.nodes.length.toLocaleString("nl-NL")} knopen</span>
        </div>
        <div className="frame3d-volume-overview-types">
          {volumeStats.tet4 > 0 && <span>Tet4 <strong>{volumeStats.tet4.toLocaleString("nl-NL")}</strong></span>}
          {volumeStats.hex8 > 0 && <span>Hex8 <strong>{volumeStats.hex8.toLocaleString("nl-NL")}</strong></span>}
        </div>
      </div>}
      <div className="fem-prop-body">
      <p className="fem-prop-hint">Selecteer een 3D-knoop, staaf, plaat, volume-element of belasting om de eigenschappen te bekijken.</p>
      {volumeStats.total > 0 && volumeSummary && <section className="frame3d-volume-model-result" aria-label="Berekeningssamenvatting">
        <span className="frame3d-volume-overview-eyebrow">BEREKEND MODEL</span>
        <div className="frame3d-volume-model-result-grid">
          <div><span>Max. verplaatsing</span><strong>{value(volumeSummary.maxDisplacementMm, 3)} <small>mm</small></strong></div>
          <div><span>Max. von Mises</span><strong>{value(volumeSummary.maxVonMisesMpa, 2)} <small>MPa</small></strong></div>
        </div>
        <span className="frame3d-volume-overview-position">Oplosser: {volumeSummary.backend}</span>
      </section>}
      {(analysis === "material" || analysis === "combined") && <Section title={t("frame3d.fnlLoadPathTitle")}>
        <p className="fem-prop-hint">{t("frame3d.fnlLoadPathDescription")}</p>
        <Row label={t("frame3d.fnlLoadPathFactors")}><input className="fem-prop-input" type="text" aria-label={t("frame3d.fnlLoadPathFactors")} placeholder="1, 0, 0.5"
          value={loadPathText} onChange={(event) => setLoadPathText(event.target.value)} /></Row>
        <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" type="button" onClick={applyLoadPath}>{t("frame3d.fnlLoadPathApply")}</button></div>
        <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" type="button" onClick={() => { setLoadPathText(""); setLoadPathError(""); onChange({ ...model, materialLoadPath: undefined }); }}>{t("frame3d.fnlLoadPathClear")}</button></div>
        {loadPathError && <p className="frame3d-check-not-ok" role="alert">{loadPathError}</p>}
      </Section>}
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
    try {
      const nextModel = { ...model, nodes };
      if ((model.volumes ?? []).some((volume) => volume.nodeIds.includes(node.id))) parseFrame3DModel(nextModel);
      onChange(nextModel);
      setCoordinateError("");
    } catch (error) {
      setCoordinateError(error instanceof Error ? error.message : String(error));
    }
  };

  const updateBeam = (patch: Partial<NonNullable<typeof beam>>) => {
    if (!beam) return;
    onChange({ ...model, beams: model.beams.map((item) => item.id === beam.id ? { ...item, ...patch } : item) });
  };

  const changeBeamNode = (end: "start" | "end", nodeId: number): boolean => {
    if (!beam) return false;
    try {
      onChange(setFrame3DBeamNodes(model, beam.id,
        end === "start" ? nodeId : beam.startNodeId,
        end === "end" ? nodeId : beam.endNodeId));
      setBeamNodeError("");
      return true;
    } catch (error) {
      setBeamNodeError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const applyRoll = () => {
    const degrees = Number(rollDegrees);
    if (!Number.isFinite(degrees)) {
      setRollDegrees(String((beam?.rollAngleRad ?? 0) * 180 / Math.PI));
      return;
    }
    updateBeam({ rollAngleRad: degrees * Math.PI / 180 });
  };

  const updateVolume = (patch: Partial<Omit<Frame3DVolume, "id">>): boolean => {
    if (!volume) return false;
    try {
      onChange(updateFrame3DVolume(model, volume.id, patch));
      setVolumeError("");
      return true;
    } catch (error) {
      setVolumeError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const updateVolumeLawField = (field: string, raw: string): boolean => {
    if (!volume?.materialLaw) return false;
    return updateVolume({ materialLaw: { ...volume.materialLaw, [field]: Number(raw) } as Frame3DVolumeMaterialLaw });
  };

  const changeVolumeBodyLoad = (loadId: number, forceKnPerM3: [number, number, number]): boolean => {
    try {
      onChange(updateFrame3DVolumeBodyLoad(model, loadId, forceKnPerM3));
      setVolumeError("");
      return true;
    } catch (error) {
      setVolumeError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const changeVolumeFaceLoad = (loadId: number, patch: Pick<Frame3DVolumeFaceLoad, "faceIndex" | "tractionKnPerM2">): boolean => {
    try {
      onChange(updateFrame3DVolumeFaceLoad(model, loadId, patch));
      setVolumeError("");
      return true;
    } catch (error) {
      setVolumeError(error instanceof Error ? error.message : String(error));
      return false;
    }
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
    : selection.type === "volume" ? `Volume-element ${selection.id}`
    : selection.type === "node" ? t("frame3d.editNode", { id: selection.id })
    : t("frame3d.editBeam", { id: selection.id });

  return <div className={`fem-properties${volume ? " frame3d-volume-properties" : ""}${beam ? " frame3d-member-properties" : ""}`} data-frame3d-properties={selection.id}>
    <div className="fem-prop-selection">
      <span className="fem-prop-selection-label">{t("frame3d.selection", "Selectie")}</span>
      <span className="fem-prop-selection-value">{selectionLabel}</span>
    </div>
    {volume && <div className="frame3d-volume-overview" aria-label="Volumemodel overzicht">
      <div className="frame3d-volume-overview-main">
        <span className="frame3d-volume-overview-eyebrow">VOLUMEMODEL</span>
        <strong>{volumeStats.total.toLocaleString("nl-NL")} elementen</strong>
        <span className="frame3d-volume-overview-position">Selectie {volumeStats.position.toLocaleString("nl-NL")} van {volumeStats.total.toLocaleString("nl-NL")}</span>
      </div>
      <div className="frame3d-volume-overview-types">
        {volumeStats.tet4 > 0 && <span>Tet4 <strong>{volumeStats.tet4.toLocaleString("nl-NL")}</strong></span>}
        {volumeStats.hex8 > 0 && <span>Hex8 <strong>{volumeStats.hex8.toLocaleString("nl-NL")}</strong></span>}
      </div>
    </div>}
    <div className="fem-prop-tabs">
      <button className={`fem-prop-tab${tab === "general" ? " active" : ""}`} onClick={() => setTab("general")}>{t("frame3d.general", "Algemeen")}</button>
      <button className={`fem-prop-tab${tab === "results" ? " active" : ""}`} onClick={() => setTab("results")}>{t("frame3d.results")}</button>
      {beam && <button className={`fem-prop-tab${tab === "norm" ? " active" : ""}`} onClick={() => setTab("norm")}>{beamIsConcrete ? "EN 1992" : "EN 1993"}</button>}
    </div>

    <div className="fem-prop-body" key={`${selection.type}:${selection.id}:${tab}`}>
      {tab === "general" && volume && <>
        <Section title="Geometrie">
          <div className="frame3d-volume-identity">
            <span className="frame3d-volume-kind">{volume.kind === "tet4" ? "Tet4" : "Hex8"}</span>
            <span>Element {volume.id}</span>
            <small>{volume.nodeIds.length} knopen</small>
          </div>
          <div className="frame3d-volume-node-preview" aria-label="Knoopvolgorde">
            {volume.nodeIds.map((nodeId, index) => <span key={index} title={`Knoop ${index + 1}: ${nodeId}`}>
              <small>{index + 1}</small>K{nodeId}
            </span>)}
          </div>
          <details className="frame3d-volume-node-editor">
            <summary>Knoopvolgorde bewerken</summary>
            <div className="frame3d-volume-node-grid">
          {volume.nodeIds.map((nodeId, index) => <label key={index} className="frame3d-volume-node-field">
            <span>Knoop {index + 1}</span>
            {model.nodes.length > 500
              ? <input key={`${volume.id}:${index}:${nodeId}`} className="fem-prop-input" type="number" min="1" step="1"
                  aria-label={`Volume-element knoop ${index + 1}`} defaultValue={nodeId}
                  onBlur={(event) => {
                    const nextId = Number(event.currentTarget.value);
                    if (nextId === nodeId) return;
                    const valid = updateVolume({ nodeIds: volume.nodeIds.map((id, current) => current === index ? nextId : id) });
                    if (!valid) event.currentTarget.value = String(nodeId);
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
              : <select className="fem-prop-input" aria-label={`Volume-element knoop ${index + 1}`} value={nodeId}
                  onChange={(event) => updateVolume({ nodeIds: volume.nodeIds.map((id, current) => current === index ? Number(event.target.value) : id) })}>
                  {model.nodes.map((candidate) => <option key={candidate.id} value={candidate.id}>K{candidate.id} ({candidate.x}, {candidate.y}, {candidate.z})</option>)}
                </select>}
          </label>)}
            </div>
          </details>
        </Section>
        <Section title="Materiaal">
          <Row label="E (MPa)"><input key={`e-${volume.id}-${volume.eMpa}`} className="fem-prop-input" type="number" min="0" step="any"
            aria-label="Volume-element elasticiteitsmodulus" defaultValue={volume.eMpa}
            onBlur={(event) => updateVolume({ eMpa: Number(event.target.value) })}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></Row>
          <Row label="Poisson ν"><input key={`nu-${volume.id}-${volume.poisson}`} className="fem-prop-input" type="number" min="0" max="0.499999" step="any"
            aria-label="Volume-element Poissongetal" defaultValue={volume.poisson}
            onBlur={(event) => updateVolume({ poisson: Number(event.target.value) })}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></Row>
          {volume.kind === "tet4" && <Row label="Rekafhankelijk β"><input
            key={`beta-${volume.id}-${volume.energyBeta ?? 0}`} className="fem-prop-input"
            type="number" step="any" aria-label="Tet4 rekafhankelijke beta"
            defaultValue={volume.energyBeta ?? 0}
            onBlur={(event) => {
              const raw = event.currentTarget.value.trim();
              if (!updateVolume({ energyBeta: raw === "" ? undefined : Number(raw) }))
                event.currentTarget.value = String(volume.energyBeta ?? 0);
            }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></Row>}
          <Row label="Dichtheid (kg/m³)"><input key={`rho-${volume.id}-${volume.densityKgPerM3 ?? ""}`} className="fem-prop-input"
            type="number" min="0" step="any" aria-label="Volume-element dichtheid" placeholder="Voor eigen gewicht"
            defaultValue={volume.densityKgPerM3 ?? ""}
            onBlur={(event) => {
              const raw = event.currentTarget.value.trim();
              if (!updateVolume({ densityKgPerM3: raw === "" ? undefined : Number(raw) })) {
                event.currentTarget.value = String(volume.densityKgPerM3 ?? "");
              }
            }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></Row>
          {volumeError && <p className="frame3d-check-not-ok" role="alert">{volumeError}</p>}
          <details className="frame3d-volume-help"><summary>Over het materiaalmodel</summary>
            <p>Lineair bij 1e orde. Tet4-GNL: W = W₀ + β·W₀²/(2E); β = 0 geeft St Venant–Kirchhoff. Negatieve β kan bij hoge rek een ongeldige tangent geven.</p>
          </details>
        </Section>
        {volume.kind === "tet4" && <Section title="Materiaal-FNL · Tet4" collapsible defaultOpen={!!volume.materialLaw || analysis === "material" || analysis === "combined"}>
          <Row label="Vervorming"><select className="fem-prop-input" aria-label="Tet4 materiaal-FNL-kinematica"
            value={model.volumeMaterialKinematics ?? "smallStrain"} onChange={(event) => {
              try {
                onChange(parseFrame3DModel({ ...model, volumeMaterialKinematics: event.target.value }));
                setVolumeError("");
              } catch (error) { setVolumeError(error instanceof Error ? error.message : String(error)); }
            }}>
            <option value="smallStrain">Kleine rek</option>
            <option value="finiteStrain">Eindige vervorming · staal-J2</option>
          </select></Row>
          <Row label="Materiaalwet"><select className="fem-prop-input" aria-label="Tet4 materiaal-FNL-wet"
            value={volume.materialLaw?.kind ?? "elastic"} onChange={(event) => {
              const kind = event.target.value;
              updateVolume({ materialLaw: kind === "steelJ2"
                ? { kind: "steelJ2", yieldMpa: 235, hardeningMpa: 1_000 }
                : kind === "concreteTensionDamage"
                  ? { kind: "concreteTensionDamage", tensileStrengthMpa: 3,
                    fractureEnergyNPerM: 100, crackBandWidthM: 0.1 }
                  : undefined });
            }}>
            <option value="elastic">Elastisch / GNL-β</option>
            <option value="steelJ2">Staal · J2-plastificatie</option>
            <option value="concreteTensionDamage">Beton · trekschade</option>
          </select></Row>
          {volume.materialLaw?.kind === "steelJ2" && ([
            ["yieldMpa", "Vloeigrens (MPa)"], ["hardeningMpa", "Verharding H (MPa)"],
          ] as const).map(([field, label]) => <Row key={field} label={label}><input
            key={`${volume.id}:${field}:${volume.materialLaw?.kind === "steelJ2" ? volume.materialLaw[field] : ""}`}
            className="fem-prop-input" type="number" min="0" step="any" aria-label={label}
            defaultValue={volume.materialLaw?.kind === "steelJ2" ? volume.materialLaw[field] : 0}
            onBlur={(event) => { if (!updateVolumeLawField(field, event.currentTarget.value))
              event.currentTarget.value = String(volume.materialLaw?.kind === "steelJ2" ? volume.materialLaw[field] : 0); }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></Row>)}
          {volume.materialLaw?.kind === "concreteTensionDamage" && ([
            ["tensileStrengthMpa", "Treksterkte (MPa)"],
            ["fractureEnergyNPerM", "Breukenergie (N/m)"],
            ["crackBandWidthM", "Scheurband h (m)"],
          ] as const).map(([field, label]) => <Row key={field} label={label}><input
            key={`${volume.id}:${field}:${volume.materialLaw?.kind === "concreteTensionDamage" ? volume.materialLaw[field] : ""}`}
            className="fem-prop-input" type="number" min="0" step="any" aria-label={label}
            defaultValue={volume.materialLaw?.kind === "concreteTensionDamage" ? volume.materialLaw[field] : 0}
            onBlur={(event) => { if (!updateVolumeLawField(field, event.currentTarget.value))
              event.currentTarget.value = String(volume.materialLaw?.kind === "concreteTensionDamage" ? volume.materialLaw[field] : 0); }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></Row>)}
          {volume.materialLaw && model.volumes?.every((item) => item.kind === "tet4") && <div className="fem-prop-kiezer-row">
            <button className="fem-prop-kiezer-btn" type="button" onClick={() => {
              try {
                onChange(parseFrame3DModel({ ...model, volumes: model.volumes?.map((item) => ({ ...item,
                  energyBeta: undefined, materialLaw: volume.materialLaw })) }));
                setVolumeError("");
              } catch (error) { setVolumeError(error instanceof Error ? error.message : String(error)); }
            }}>Deze wet op alle Tet4 toepassen</button>
          </div>}
          <details className="frame3d-volume-help"><summary>Geldigheid van deze materiaalroute</summary>
            <p>Alle Tet4-elementen in één FNL-berekening moeten dezelfde wetfamilie hebben. Eindige vervorming is voorlopig alleen beschikbaar voor J2-staal; de lasten zijn vast in de referentieconfiguratie. Voor beton is de scheurbandbreedte expliciete invoer; algemene 3D-meshobjectiviteit en constructieve toetsing zijn niet gevalideerd.</p>
          </details>
          {analysis !== "material" && <p className="fem-prop-hint">Kies onderaan Materiaal-FNL (Tet4) om deze wet te gebruiken.</p>}
        </Section>}
        <Section title="Volumekrachten" badge={volumeBodyLoads.length} collapsible>
          <details className="frame3d-volume-help"><summary>Eenheden en verdeling</summary>
            <p>Uniforme kracht per m³ in globale X, Y en Z. De Rust-kern verdeelt deze consistent over de elementknopen.</p>
          </details>
          {volumeBodyLoads.map((load) => <div key={load.id} className="frame3d-volume-load-card">
            <Row label={`Last ${load.id} · geval ${frame3DLoadCaseId(load)}`}><button className="fem-prop-kiezer-btn" type="button"
              onClick={() => onChange(removeFrame3DVolumeBodyLoad(model, load.id))}>Verwijderen</button></Row>
            {(["X", "Y", "Z"] as const).map((axis, index) => <Row key={axis} label={`${axis} (kN/m³)`}>
              <input key={`${load.id}:${index}:${load.forceKnPerM3[index]}`} className="fem-prop-input" type="number" step="any"
                aria-label={`Volumekracht ${load.id} ${axis}`} defaultValue={load.forceKnPerM3[index]}
                onBlur={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (next === load.forceKnPerM3[index]) return;
                  const values = load.forceKnPerM3.map((component, current) => current === index ? next : component) as [number, number, number];
                  if (!changeVolumeBodyLoad(load.id, values)) event.currentTarget.value = String(load.forceKnPerM3[index]);
                }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            </Row>)}
          </div>)}
          <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" type="button" onClick={() => {
            try {
              onChange(addFrame3DVolumeBodyLoad(model, volume.id, [0, 0, -1], activeLoadCaseId));
              setVolumeError("");
            } catch (error) { setVolumeError(error instanceof Error ? error.message : String(error)); }
          }}>Volumekracht toevoegen aan actief geval</button></div>
        </Section>
        <Section title="Volumevlaktracties" badge={volumeFaceLoads.length} collapsible>
          <details className="frame3d-volume-help"><summary>Eenheden en vlakvolgorde</summary>
            <p>Uniforme tractie in globale X, Y en Z (kN/m²) op één elementvlak. Het vlaknummer volgt de getoonde knoopvolgorde.</p>
          </details>
          {volumeFaceLoads.map((load) => <div key={load.id} className="frame3d-volume-load-card">
            <Row label={`Last ${load.id} · geval ${frame3DLoadCaseId(load)}`}><button className="fem-prop-kiezer-btn" type="button"
              onClick={() => onChange(removeFrame3DVolumeFaceLoad(model, load.id))}>Verwijderen</button></Row>
            <Row label="Vlak"><select className="fem-prop-input" aria-label={`Volumevlaktractie ${load.id} vlak`}
              value={load.faceIndex} onChange={(event) => changeVolumeFaceLoad(load.id,
                { faceIndex: Number(event.target.value), tractionKnPerM2: load.tractionKnPerM2 })}>
              {frame3DVolumeFaces(volume.kind).map((face, index) => <option key={index} value={index}>
                {index + 1}: {face.map((local) => `K${volume.nodeIds[local]}`).join("–")}
              </option>)}
            </select></Row>
            {(["X", "Y", "Z"] as const).map((axis, index) => <Row key={axis} label={`${axis} (kN/m²)`}>
              <input key={`${load.id}:${index}:${load.tractionKnPerM2[index]}`} className="fem-prop-input" type="number" step="any"
                aria-label={`Volumevlaktractie ${load.id} ${axis}`} defaultValue={load.tractionKnPerM2[index]}
                onBlur={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (next === load.tractionKnPerM2[index]) return;
                  const values = load.tractionKnPerM2.map((component, current) => current === index ? next : component) as [number, number, number];
                  if (!changeVolumeFaceLoad(load.id, { faceIndex: load.faceIndex, tractionKnPerM2: values })) {
                    event.currentTarget.value = String(load.tractionKnPerM2[index]);
                  }
                }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            </Row>)}
          </div>)}
          <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" type="button" onClick={() => {
            try {
              onChange(addFrame3DVolumeFaceLoad(model, volume.id, 0, [0, 0, -1], activeLoadCaseId));
              setVolumeError("");
            } catch (error) { setVolumeError(error instanceof Error ? error.message : String(error)); }
          }}>Vlaktractie toevoegen aan actief geval</button></div>
        </Section>
        <Section title="Volume- en raamwerkoplosser" collapsible defaultOpen={false}>
          <details className="frame3d-volume-help"><summary>Wanneer gebruik je welke methode?</summary>
            <p>Lineair: gedeeld Tet4/Hex8/staafmodel, met matrixvrije of directe oplosser. Tet4-GNL gebruikt een Newton-tangent. Bij eindige J2-staalvervorming zijn ook Sparse, Frontaal en Matrixvrij GMRES beschikbaar. Threads gelden voor matrixvrije PCG en GMRES.</p>
          </details>
          <Row label="Strategie"><select className="fem-prop-input" aria-label="Volume-oplosstrategie"
            value={model.volumeBackend ?? "automatic"}
            onChange={(event) => {
              try {
                onChange(parseFrame3DModel({ ...model, volumeBackend: event.target.value as Frame3DVolumeBackend }));
                setVolumeError("");
              } catch (error) { setVolumeError(error instanceof Error ? error.message : String(error)); }
            }}>
            {FRAME3D_VOLUME_BACKENDS.map((backend) => <option key={backend} value={backend}>{({
              automatic: "Automatisch", matrixFreePcg: "Matrixvrij PCG", sparsePcg: "Sparse PCG",
              sparseDirect: "Sparse direct", frontalWave: "Frontale wavefront", dense: "Dicht (referentie)",
              sparseGmres: "Sparse GMRES · materiaal-FNL",
              matrixFreeGmres: "Matrixvrij GMRES · eindige J2",
              matrixFreeGmresLarge: "Matrixvrij GMRES groot · eindige J2",
            } as Record<Frame3DVolumeBackend, string>)[backend]}</option>)}
          </select></Row>
          <Row label="Threads"><input key={`volume-threads-${model.volumeThreads ?? 4}`} className="fem-prop-input"
            type="number" min="1" max="32" step="1" aria-label="Volume-solverthreads"
            defaultValue={model.volumeThreads ?? 4}
            onBlur={(event) => {
              try {
                onChange(parseFrame3DModel({ ...model, volumeThreads: Number(event.currentTarget.value) }));
                setVolumeError("");
              } catch (error) {
                setVolumeError(error instanceof Error ? error.message : String(error));
                event.currentTarget.value = String(model.volumeThreads ?? 4);
              }
            }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></Row>
          <Row label="Newton-residu"><input
            key={`volume-residual-${model.volumeResidualTolerance ?? 1e-9}`}
            className="fem-prop-input" type="number" min="1e-12" max="1e-4" step="any"
            aria-label="Volume-FNL Newton-tolerantie"
            defaultValue={model.volumeResidualTolerance ?? 1e-9}
            onBlur={(event) => {
              try {
                onChange(parseFrame3DModel({ ...model,
                  volumeResidualTolerance: Number(event.currentTarget.value) }));
                setVolumeError("");
              } catch (error) {
                setVolumeError(error instanceof Error ? error.message : String(error));
                event.currentTarget.value = String(model.volumeResidualTolerance ?? 1e-9);
              }
            }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></Row>
        </Section>
      </>}
      {tab === "general" && node && <>
        <Section title={t("frame3d.geometry", "Geometrie")}>
          <Row label="ID"><code>{node.id}</code></Row>
          {(["x", "y", "z"] as const).map((axis) => <Row key={axis} label={`${axis.toUpperCase()} (m)`}>
            <input className="fem-prop-input" type="number" step="any" value={coordinates[axis]}
              onChange={(event) => setCoordinates({ ...coordinates, [axis]: event.target.value })}
              onBlur={applyCoordinates}
              onKeyDown={(event) => { if (event.key === "Enter") { applyCoordinates(); event.currentTarget.blur(); } }} />
          </Row>)}
          {coordinateError && <p className="frame3d-check-not-ok" role="alert">{coordinateError}</p>}
        </Section>
        <Frame3DNodeConditions model={model} nodeId={node.id} onChange={onChange}
          loadEditorRequest={loadEditorRequest} springEditorRequest={springEditorRequest}
          activeLoadCaseId={activeLoadCaseId}
          selectedLoadId={selection.type === "nodalLoad" ? selection.id : undefined} />
      </>}

      {tab === "general" && beam && <>
        <Section title={t("frame3d.geometry", "Geometrie")}>
          <Row label="ID"><code>{beam.id}</code></Row>
          {(model.volumes?.length ?? 0) > 0 && <div className="frame3d-member-kind">
            <label htmlFor={`frame3d-member-kind-${beam.id}`}>Staafwerking</label>
            <select id={`frame3d-member-kind-${beam.id}`} className="fem-prop-input"
            aria-label="3D-staafwerking" value={beam.axialOnly ? "axial" : "frame"}
            onChange={(event) => updateBeam(event.target.value === "axial"
              ? { axialOnly: true, releases: undefined, nonlinearLaw: undefined }
              : { axialOnly: undefined })}>
            <option value="frame">Raamwerk · buiging en normaalkracht</option>
            <option value="axial" disabled={(model.memberLoads ?? []).some((load) => load.beamId === beam.id)
              || (model.memberPointLoads ?? []).some((load) => load.beamId === beam.id)
              || (model.thermalLoads ?? []).some((load) => load.beamId === beam.id)
              || (model.loads ?? []).some((load) => (load.nodeId === beam.startNodeId || load.nodeId === beam.endNodeId)
                && [load.mx, load.my, load.mz].some((moment) => moment !== 0))}>
              Trekstaaf · alleen normaalkracht</option>
          </select></div>}
          {beam.axialOnly && <details className="frame3d-volume-help"><summary>Wat berekent een trekstaaf?</summary>
            <p>Alleen translatievrijheidsgraden en normaalkracht. Staalplastificatie is beschikbaar met eindige-rek J2-Tet4/Hex8-volumes; staaflasten, torsie en buiging blijven uitgesloten.</p>
          </details>}
          <Row label={t("frame3d.startNode")}>{model.nodes.length > 500
            ? <input key={`start-${beam.id}-${beam.startNodeId}`} className="fem-prop-input" type="number" min="1" step="1"
                aria-label="Beginknoop ID" defaultValue={beam.startNodeId}
                onBlur={(event) => { if (!changeBeamNode("start", Number(event.currentTarget.value))) event.currentTarget.value = String(beam.startNodeId); }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            : <select className="fem-prop-input" value={beam.startNodeId}
                onChange={(event) => changeBeamNode("start", Number(event.target.value))}>
                {model.nodes.map((candidate) => <option key={candidate.id} value={candidate.id}
                  disabled={candidate.id === beam.endNodeId || (
                    candidate.x === beamGeometry?.end.x && candidate.y === beamGeometry?.end.y && candidate.z === beamGeometry?.end.z
                  )}>K{candidate.id} ({candidate.x}, {candidate.y}, {candidate.z})</option>)}
              </select>}</Row>
          <Row label={t("frame3d.endNode")}>{model.nodes.length > 500
            ? <input key={`end-${beam.id}-${beam.endNodeId}`} className="fem-prop-input" type="number" min="1" step="1"
                aria-label="Eindknoop ID" defaultValue={beam.endNodeId}
                onBlur={(event) => { if (!changeBeamNode("end", Number(event.currentTarget.value))) event.currentTarget.value = String(beam.endNodeId); }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            : <select className="fem-prop-input" value={beam.endNodeId}
                onChange={(event) => changeBeamNode("end", Number(event.target.value))}>
                {model.nodes.map((candidate) => <option key={candidate.id} value={candidate.id}
                  disabled={candidate.id === beam.startNodeId || (
                    candidate.x === beamGeometry?.start.x && candidate.y === beamGeometry?.start.y && candidate.z === beamGeometry?.start.z
                  )}>K{candidate.id} ({candidate.x}, {candidate.y}, {candidate.z})</option>)}
              </select>}</Row>
          {beamNodeError && <p className="frame3d-check-not-ok" role="alert">{beamNodeError}</p>}
          <Row label={t("frame3d.length", "Lengte")}><code>{value(beamGeometry?.length ?? 0)} m</code></Row>
        </Section>
        <Section title={t("frame3d.crossSection", "Profiel en materiaal")}>
          <div className="frame3d-beam-material">
            <div><span>{t("frame3d.profile")}</span><strong>{beam.profileName || "—"}</strong></div>
            <div><span>Materiaal</span><strong>{beam.material || "—"}</strong></div>
            {beam.material && beam.material in TIMBER_G_MEAN && <>
              <div><span>E₀,mean</span><strong>{eVanMateriaal(beam.material).E.toLocaleString("nl-NL")} N/mm²</strong></div>
              <div><span>E₉₀,mean</span><strong>{TIMBER_E90_MEAN[beam.material].toLocaleString("nl-NL")} N/mm²</strong></div>
              <div><span>Gmean</span><strong>{TIMBER_G_MEAN[beam.material].toLocaleString("nl-NL")} N/mm²</strong></div>
              <div><span>ρmean</span><strong>{TIMBER_RHO_MEAN[beam.material].toLocaleString("nl-NL")} kg/m³</strong></div>
            </>}
          </div>
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
          {(!beam.axialOnly || (model.volumes?.length ?? 0) > 0) && <Frame3DNonlinearLawEditor key={beam.id} law={beam.nonlinearLaw}
            steelOnly={beam.axialOnly} hint={beam.axialOnly
              ? "Alleen bij eindige-rek J2-Tet4 materiaal-FNL. De verhouding voor na vloeien moet kleiner dan 1 zijn."
              : undefined}
            onApply={(law) => onChange({ ...model, beams: model.beams.map((item) => item.id === beam.id
              ? { ...item, nonlinearLaw: law } : item) })} />}
        </Section>
        {!beam.axialOnly && <Section title={t("frame3d.localAxesAndReleases", "Lokale assen en eindscharnieren")}>
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
        </Section>}
        {!beam.axialOnly && <Frame3DMemberLoads model={model} beamId={beam.id} lengthM={beamGeometry?.length ?? 0}
          onChange={onChange} editorRequest={memberLoadEditorRequest} pointEditorRequest={memberPointLoadEditorRequest}
          thermalEditorRequest={thermalLoadEditorRequest}
          selectedLoad={selection.type === "memberLoad" || selection.type === "memberPointLoad" || selection.type === "thermalLoad"
            ? { kind: selection.type, id: selection.id }
            : undefined}
          activeLoadCaseId={activeLoadCaseId} />}
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
          {!plate.membraneOnly && <Row label="Randstraal (m)"><input className="fem-prop-input" type="number" min="0" step="0.01"
            defaultValue={plate.cornerRadiusM ?? 0} key={`radius-${plate.id}-${plate.cornerRadiusM ?? 0}`}
            onBlur={(event) => { const next = Number(event.currentTarget.value); if (next >= 0) onChange(updateFrame3DPlate(model, plate.id, { cornerRadiusM: next })); }} /></Row>}
          <Row label="Materiaal"><input className="fem-prop-input" defaultValue={plate.material ?? "C30/37"}
            key={`material-${plate.id}-${plate.material}`}
            onBlur={(event) => onChange(updateFrame3DPlate(model, plate.id, { material: event.currentTarget.value.trim() || "C30/37" }))} /></Row>
          <Row label="Openingen"><code>{plate.openings?.length ?? 0}</code></Row>
        </Section>
        {plate.nodeIds.length === 3 && <Section title="Gekoppeld Tri3-membraan">
          <p className="fem-prop-hint">Vlakspanning in het plaatvlak, elastisch of met bilineaire staalwet bij eindige-rek J2-analyse. Bij gedeelde knopen draagt dit element samen met Tet4 de drie translaties; het draagt geen buiging.</p>
          <Row label="Membraan"><input type="checkbox" aria-label="Tri3-membraan koppelen aan volumes"
            checked={plate.membraneOnly === true} onChange={(event) => {
              try {
                const enabled = event.currentTarget.checked;
                const eMpa = eVanMateriaal(plate.material ?? "C30/37").E;
                onChange(updateFrame3DPlate(model, plate.id, enabled
                  ? { membraneOnly: true, membraneEMpa: eMpa,
                    membranePoisson: plate.material?.startsWith("C") ? 0.2 : 0.3 }
                  : { membraneOnly: undefined, membraneEMpa: undefined, membranePoisson: undefined }));
                setMembraneError("");
              } catch (error) { setMembraneError(error instanceof Error ? error.message : String(error)); }
            }} /></Row>
          {plate.membraneOnly && <>
            <Row label="E (MPa)"><input className="fem-prop-input" type="number" min="0" step="any"
              aria-label="Tri3-membraan elasticiteitsmodulus" key={`mem-e-${plate.id}-${plate.membraneEMpa}`}
              defaultValue={plate.membraneEMpa} onBlur={(event) => {
                try { onChange(updateFrame3DPlate(model, plate.id, { membraneEMpa: Number(event.currentTarget.value) })); setMembraneError(""); }
                catch (error) { setMembraneError(error instanceof Error ? error.message : String(error)); event.currentTarget.value = String(plate.membraneEMpa); }
              }} /></Row>
            <Row label="Poisson ν"><input className="fem-prop-input" type="number" min="0" max="0.499999" step="any"
              aria-label="Tri3-membraan Poissongetal" key={`mem-nu-${plate.id}-${plate.membranePoisson}`}
              defaultValue={plate.membranePoisson} onBlur={(event) => {
                try { onChange(updateFrame3DPlate(model, plate.id, { membranePoisson: Number(event.currentTarget.value) })); setMembraneError(""); }
                catch (error) { setMembraneError(error instanceof Error ? error.message : String(error)); event.currentTarget.value = String(plate.membranePoisson); }
              }} /></Row>
            <Frame3DNonlinearLawEditor law={plate.nonlinearLaw} steelOnly
              hint="Bilineaire staalwet bij eindige-rek J2-analyse met Tet4/Hex8-volumes. Zonder wet blijft het membraan elastisch."
              onApply={(nonlinearLaw) => {
                try { onChange(updateFrame3DPlate(model, plate.id, { nonlinearLaw })); setMembraneError(""); }
                catch (error) { setMembraneError(error instanceof Error ? error.message : String(error)); }
              }} />
          </>}
          {membraneError && <p className="frame3d-check-not-ok" role="alert">{membraneError}</p>}
        </Section>}
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
        {!plate.membraneOnly && <Section title={t("frame3d.fnlPlateCurveTitle")}>
          <p className="fem-prop-hint">{t("frame3d.fnlPlateCurveDescription", {
            materialE: Number.isFinite(eVanMateriaal(plate.material ?? "").E) ? eVanMateriaal(plate.material ?? "").E : "—",
          })}</p>
          <Row label={t("frame3d.fnlPlateCurveLabel")}><textarea className="fem-prop-input" aria-label={t("frame3d.fnlPlateCurveLabel")} rows={3}
            placeholder={t("frame3d.fnlPlateCurvePlaceholder")}
            value={plateCurveText} onChange={(event) => setPlateCurveText(event.target.value)} /></Row>
          <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" type="button" onClick={() => {
            try {
              const points = plateCurveText.trim().split(/[;\n]+/).map((piece) => {
                const parts = piece.trim().split(":");
                if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) throw new Error(t("frame3d.fnlPlateCurveInvalid"));
                return { strain: Number(parts[0].trim()), eMpa: Number(parts[1].trim()) };
              });
              onChange(updateFrame3DPlate(model, plate.id, { modulusCurve: points }));
              setPlateCurveError("");
            } catch (error) { setPlateCurveError(error instanceof Error ? error.message : String(error)); }
          }}>{t("frame3d.fnlPlateCurveApply")}</button>
            <button className="fem-prop-kiezer-btn" type="button" onClick={() => {
              onChange(updateFrame3DPlate(model, plate.id, { modulusCurve: undefined }));
              setPlateCurveText(""); setPlateCurveError("");
            }}>{t("frame3d.fnlPlateCurveClear")}</button></div>
          {plateCurveError && <p className="frame3d-check-not-ok" role="alert">{plateCurveError}</p>}
        {analysis !== "material" && analysis !== "combined" && <p className="fem-prop-hint">{t("frame3d.fnlPlateCurveChooseAnalysis")}</p>}
        </Section>}
        {!plate.membraneOnly && <Section title={t("props.frame3dNonlinear.shellTitle")}>
          <p className="fem-prop-hint">{t("props.frame3dNonlinear.shellDescription")}</p>
          <Frame3DNonlinearLawEditor law={plate.nonlinearLaw}
            hint={t("props.frame3dNonlinear.shellHint")}
            onApply={(nonlinearLaw) => onChange(updateFrame3DPlate(model, plate.id, { nonlinearLaw }))} />
          {analysis !== "p-delta" && <p className="fem-prop-hint">{t("props.frame3dNonlinear.shellAnalysisHint")}</p>}
        </Section>}
        {!plate.membraneOnly && plate.material && plate.material in CONCRETE_E_CM
          && <Frame3DPlateReinforcementEditor model={model} plate={plate} onChange={onChange} />}
        {!plate.membraneOnly && plate.material && plate.material in CONCRETE_E_CM
          && <Frame3DPlateThreeLayerEditor model={model} plate={plate} onChange={onChange} />}
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
        {!plate.membraneOnly && <Section title="Randlijnlasten · normaal op plaat">
          <p className="fem-prop-hint">Perimeterzijde 1–4 volgens de knoopvolgorde van de plaat. Intensiteiten in kN/m, positief in de plaatnormaal.</p>
          {(model.plateEdgeLoads ?? []).filter((load) => load.plateId === plate.id).map((edgeLoad) => <div key={edgeLoad.id} className="fem-prop-edge-load">
            <Row label={`Randlast ${edgeLoad.id}`}><select className="fem-prop-input" aria-label={`Plaat ${plate.id} randlast ${edgeLoad.id} zijde`}
              value={edgeLoad.edgeIndex} onChange={(event) => onChange(updateFrame3DPlateEdgeLoad(model, edgeLoad.id, { edgeIndex: Number(event.currentTarget.value), startKnPerM: edgeLoad.startKnPerM, endKnPerM: edgeLoad.endKnPerM }))}>
              {[0, 1, 2, 3].map((edge) => <option key={edge} value={edge}>{edge + 1}</option>)}
            </select></Row>
            {(["startKnPerM", "endKnPerM"] as const).map((key) => <Row key={key} label={`${key === "startKnPerM" ? "Begin" : "Eind"} (kN/m)`}>
              <input className="fem-prop-input" type="number" step="any" defaultValue={edgeLoad[key]} key={`${edgeLoad.id}-${key}-${edgeLoad[key]}`}
                onBlur={(event) => { const next = Number(event.currentTarget.value); if (Number.isFinite(next)) onChange(updateFrame3DPlateEdgeLoad(model, edgeLoad.id, { edgeIndex: edgeLoad.edgeIndex, startKnPerM: key === "startKnPerM" ? next : edgeLoad.startKnPerM, endKnPerM: key === "endKnPerM" ? next : edgeLoad.endKnPerM })); }} />
            </Row>)}
            <button className="frame3d-delete" type="button" onClick={() => onChange(removeFrame3DPlateEdgeLoad(model, edgeLoad.id))}>Randlast verwijderen</button>
          </div>)}
          <button className="fem-prop-kiezer-btn" type="button" onClick={() => onChange(addFrame3DPlateEdgeLoad(model, plate.id, 0, -1, -1, activeLoadCaseId))}>Randlijnlast toevoegen</button>
        </Section>}
      </>}

      {tab === "results" && <>
        {!result && <p className="fem-prop-hint">{t("frame3d.readyToCalculate")}</p>}
        {coupledBendingResult && <Section title={`Gekoppelde DKT-buigplaat ${coupledBendingResult.plateId}`}>
          <Row label="XY-driehoeken"><code>{coupledBendingResult.triangleCount}</code></Row>
          <Row label="Max. |w|"><code>{value(coupledBendingResult.maxAbsWm * 1000)} mm</code></Row>
          <Row label="Max. |rotatie|"><code>{value(coupledBendingResult.maxAbsRotationRad * 1000)} mrad</code></Row>
          {coupledBendingResult.maxAbsMomentKnmPerM && <Row label="Max. |Mx| / |My| / |Mxy|"><code>{coupledBendingResult.maxAbsMomentKnmPerM.map((moment) => value(moment)).join(" / ")} kNm/m</code></Row>}
          {coupledBendingResult.centroidMoments?.slice(0, 100).map((triangle) => <Row key={triangle.triangleIndex}
            label={`Tri3 ${triangle.triangleIndex} · Mx / My / Mxy`}>
            <code>{triangle.momentKnmPerM.map((moment) => value(moment)).join(" / ")} kNm/m</code>
          </Row>)}
          {(coupledBendingResult.centroidMoments?.length ?? 0) > 100 && <p className="fem-prop-hint">
            Eerste 100 van {coupledBendingResult.centroidMoments?.length ?? 0} driehoeken getoond; {(coupledBendingResult.centroidMoments?.length ?? 0) - 100} overige blijven in het berekeningsresultaat.
          </p>}
          <p className="fem-prop-hint">{coupledBendingResult.centroidMoments
            ? "Elastische globale XY-buigmomenten in het zwaartepunt van elke driehoek, uit de laatste verplaatsingen met vaste referentiestijfheid. Eigen plaat-GNL/FNL is niet berekend."
            : "Deze plaat behoudt elastische referentiestijfheid in de volume-GNL/J2-berekening; plaat-GNL/FNL en plaatmomenten zijn niet herleid."} Geen plaatmembraan, dwarskrachtresultanten, oppervlaktespanning of constructieve plaattoetsing.</p>
        </Section>}
        {membraneResult && <Section title={`Tri3-membraan ${membraneResult.plateId} · lokaal`}>
          <p className="fem-prop-hint">{membraneResult.stressMeasure === "cauchy"
            ? "Cauchy-spanning en membraankracht per huidige lengte; lokale as 1 volgt de vervormde zijde van knoop 1 naar 2."
            : "Tweede Piola–Kirchhoff-spanning en membraankracht per referentielengte; lokale as 1 volgt knoop 1 naar 2."}</p>
          {(["σ11", "σ22", "τ12"] as const).map((label, index) => <Row key={label} label={label}>
            <code>{value(membraneResult.stressMpa[index])} MPa</code></Row>)}
          {(["N11", "N22", "N12"] as const).map((label, index) => <Row key={label} label={label}>
            <code>{value(membraneResult.resultantsKnPerM[index])} kN/m</code></Row>)}
          {membraneResult.equivalentPlasticStrain !== undefined &&
            <Row label="Equiv. plastische rek"><code>{value(membraneResult.equivalentPlasticStrain, 7)}</code></Row>}
          {membraneResult.thicknessStretch !== undefined &&
            <Row label="Dikterekfactor"><code>{value(membraneResult.thicknessStretch, 7)}</code></Row>}
          <p className="fem-prop-hint">Lokale as 2 ligt in het membraanvlak. Geen buigresultaten.</p>
        </Section>}
        {volume && result && !volumeResult && <p className="fem-prop-hint">Voor dit volume-element is geen spanning beschikbaar.</p>}
        {volumeResult && <>
          <div className="frame3d-volume-result-summary">
            <div><span>VON MISES</span><strong>{value(volumeResult.vonMisesMpa)}</strong><small>MPa</small></div>
            <p>{volumeResult.kind === "tet4" ? "Tet4" : "Hex8"} #{volumeResult.elementId}
              {result?.volume3D?.formulation === "totalLagrangianJ2" ? " · Cauchy, GNL + J2-staal"
                : result?.volume3D?.formulation === "totalLagrangian" ? " · Cauchy, eindgeometrie"
                : result?.volume3D?.formulation === "smallStrainMaterial" ? " · materiaal-FNL, kleine rek" : " · lineaire spanning"}</p>
          </div>
          <Section title="Spanningscomponenten">
          {(["σx", "σy", "σz", "τxy", "τyz", "τzx"] as const).map((label, index) =>
            <Row key={label} label={label}><code>{value(volumeResult.stressMpa[index])} MPa</code></Row>)}
          </Section>
          {volumeResult.gaussStressMpa && <Section title={`Hex8 Gauss-punten (${volumeResult.gaussStressMpa.length})`} collapsible defaultOpen={false}>
            <p className="fem-prop-hint">Cauchy-spanning per integratiepunt in MPa; de hoofdwaarden hierboven zijn het gemiddelde van acht punten.</p>
            {volumeResult.gaussStressMpa.map((stress, index) =>
              <Row key={index} label={`Punt ${index + 1}`}><code>
                σ {stress.slice(0, 3).map((part) => value(part)).join(" / ")} · τ {stress.slice(3).map((part) => value(part)).join(" / ")}
                {volumeResult.gaussEquivalentPlasticStrain && ` · εp,eq ${value(volumeResult.gaussEquivalentPlasticStrain[index], 7)}`}
              </code></Row>)}
          </Section>}
          {volumeResult.firstPiolaMpa && <Section title="Eerste Piola-spanning P" collapsible defaultOpen={false}>
            <p className="fem-prop-hint">Nominale spanning per referentieoppervlak; de componenten hierboven zijn Cauchy-spanningen in de eindgeometrie.</p>
            {(["11", "12", "13", "21", "22", "23", "31", "32", "33"] as const).map((name) =>
              <Row key={name} label={`P${name}`}><code>{value(volumeResult.firstPiolaMpa![Number(name[0]) - 1][Number(name[1]) - 1])} MPa</code></Row>)}
          </Section>}
          {(volumeResult.greenStrain || volumeResult.effectiveEMpa !== undefined
            || volumeResult.equivalentPlasticStrain !== undefined || volumeResult.tensileDamage !== undefined)
            && <Section title="Rek en materiaal">
          {volumeResult.greenStrain && (["E11", "E22", "E33", "E12", "E23", "E31"] as const).map((label, index) => {
            const [i, j] = ([[0, 0], [1, 1], [2, 2], [0, 1], [1, 2], [2, 0]] as const)[index];
            return <Row key={label} label={`Green ${label}`}><code>{value(volumeResult.greenStrain![i][j], 7)}</code></Row>;
          })}
          {volumeResult.effectiveEMpa !== undefined && <Row label="Effectieve E"><code>{value(volumeResult.effectiveEMpa)} MPa</code></Row>}
          {volumeResult.equivalentPlasticStrain !== undefined && <Row label="Equiv. plastische rek"><code>{value(volumeResult.equivalentPlasticStrain, 7)}</code></Row>}
          {volumeResult.tensileDamage !== undefined && <Row label="Trekschade"><code>{value(volumeResult.tensileDamage, 5)}</code></Row>}
          </Section>}
          {result?.volume3D && <Section title="Oplosser">
            <Row label="Methode"><code>{result.volume3D.backendUsed}</code></Row>
            {result.volume3D.formulation !== "totalLagrangian" && <Row label="Iteraties"><code>{result.volume3D.linearIterations}</code></Row>}
            <Row label="Relatief residu"><code>{result.volume3D.relativeResidual.toExponential(2)}</code></Row>
            {result.volume3D.newtonIterations !== undefined && <Row label="Newton-iteraties"><code>{result.volume3D.newtonIterations}</code></Row>}
          </Section>}
        </>}
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
          {plate?.nonlinearLaw && <>
            <Row label={t("frame3d.maxPlasticStrain")}><code>{value(Math.max(...plateResult.elements.map((element) => element.maxEquivalentPlasticStrain ?? 0)), 6)}</code></Row>
            <Row label={t("frame3d.maxTensileDamage")}><code>{value(Math.max(...plateResult.elements.map((element) => element.maxTensileDamage ?? 0)), 4)}</code></Row>
          </>}
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
          {(result?.analysis === "material" || result?.analysis === "combined") && memberForces.effectiveEMpa !== undefined
            && <Row label="E effectief"><code>{value(memberForces.effectiveEMpa, 0)} MPa</code></Row>}
          {memberForces.axialHistory && <>
            <Row label="Plastische rek"><code>{value(memberForces.axialHistory.plasticStrain, 6)}</code></Row>
            <Row label="Equiv. plastische rek"><code>{value(memberForces.axialHistory.equivalentPlasticStrain, 6)}</code></Row>
            <Row label="Trekschade"><code>{value(memberForces.axialHistory.tensileDamage, 4)}</code></Row>
            <Row label="E tangent axiaal"><code>{value(memberForces.axialHistory.tangentEMpa, 0)} MPa</code></Row>
          </>}
          {memberForces.sectionHistory && <>
            <Row label="Max. plastische doorsnederek"><code>{value(memberForces.sectionHistory.maximumAbsPlasticStrain, 6)}</code></Row>
            <Row label="Max. equivalente plastische doorsnederek"><code>{value(memberForces.sectionHistory.maximumEquivalentPlasticStrain, 6)}</code></Row>
            <Row label="Max. trekschade doorsnede"><code>{value(memberForces.sectionHistory.maximumTensileDamage, 4)}</code></Row>
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
