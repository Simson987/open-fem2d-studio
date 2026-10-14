import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ProfielKiezer from "../fem/ProfielKiezer";
import OpenFem3DNodeConditions, { type OpenFem3DLoadEditorRequest, type OpenFem3DSpringEditorRequest } from "./OpenFem3DNodeConditions";
import OpenFem3DMemberLoads from "./OpenFem3DMemberLoads";
import OpenFem3DLoadPanelProperties from "./OpenFem3DLoadPanelProperties";
import OpenFem3DEnvelopePanelProperties from "./OpenFem3DEnvelopePanelProperties";
import { OpenFem3DDiaphragmFromSelection, OpenFem3DNodeDiaphragmRow, OpenFem3DTensionOnlyField } from "./OpenFem3DTrekSchijfVelden";
import { OpenFem3DBeddingField, OpenFem3DBeddingResults } from "./OpenFem3DBeddingVeld";
import { OpenFem3DPlateBeddingField, OpenFem3DPlateBeddingResults } from "./OpenFem3DPlaatBeddingVeld";
import { openFem3DBeddingRefusal } from "./openFem3dBedding";
import { openFem3DSelectionLoadCount, type OpenFem3DSelection } from "./openFem3dSelection";
import { openFem3DSelectieBelastinggevallen, openFem3DSelectieIds } from "./openFem3dSelectieFilter";
import {
  applyOpenFem3DProfileChoice, assertOpenFem3DBeddingFitsGeometry, flipOpenFem3DBeamLocalAxes, openFem3DReleasePresetOf, openFem3DSupportPresetOf, removeOpenFem3DSurfaceLoad, setOpenFem3DBeamNodes,
  setOpenFem3DReleasePreset, updateOpenFem3DBeam, updateOpenFem3DPlate, updateOpenFem3DSurfaceLoad, type OpenFem3DModel, type OpenFem3DReleasePreset,
  type OpenFem3DSupportPreset,
} from "./openFem3dModel";
import {
  linkOpenFem3DToLevel, openFem3DLevelName, openFem3DLevelRefusalText, openFem3DLevelsByHeight,
  openFem3DPlateHoldingNode, withConsistentOpenFem3DPlateLevels, type OpenFem3DLevel,
} from "./openFem3dLevels";
import { OPEN_FEM_3D_EDGE_SUPPORT_CHOICES, openFem3DPlateEdges, withOpenFem3DPlateEdgeSupport } from "./openFem3dPlateEdges";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import { formatOpenFem3DPlateValue, openFem3DPlateExtremes } from "./openFem3dPlateResults";
import {
  checkUc,
  openFem3DGoverningUlsCheck,
  openFem3DUlsUc,
  type OpenFem3DSteelChecks,
} from "./openFem3dSteelCheck";
import { matchSupportedConcreteClass } from "../../lib/betonCheckBuilder";
import { matchSupportedTimberGrade } from "../../lib/timberCheckBuilder";
import { openFem3DTimberGoverningUlsCheck, openFem3DTimberUlsUc, type OpenFem3DTimberChecks } from "./openFem3dTimberCheck";
import { doorsnedeNaamVertaald } from "../../lib/verloopKeuze";
import { openFem3DBeamAls2D } from "./openFem3dVerloop";
import { toonMm } from "../../lib/lengthInput";
import LengthInput from "../LengthInput";
import type { OpenFem3DConcreteChecks } from "./openFem3dConcreteCheck";
import KolomVelden from "../beton/KolomVelden";
import OpenFem3DAnalysisMaterialField from "./OpenFem3DAnalysisMaterialField";
import "../fem/FemProperties.css";
import "./OpenFem3DProperties.css";

interface Props {
  model: OpenFem3DModel;
  selection: OpenFem3DSelection;
  onChange: (model: OpenFem3DModel) => void;
  result: OpenFem3DSolveResult | null;
  checks?: OpenFem3DSteelChecks | null;
  concreteChecks?: OpenFem3DConcreteChecks | null;
  timberChecks?: OpenFem3DTimberChecks | null;
  checksRunning?: boolean;
  checksError?: string | null;
  loadEditorRequest?: OpenFem3DLoadEditorRequest | null;
  springEditorRequest?: OpenFem3DSpringEditorRequest | null;
  memberLoadEditorRequest?: number;
  memberPointLoadEditorRequest?: number;
  thermalLoadEditorRequest?: number;
  activeLoadCaseId?: number;
  normFocus?: { beamId: number; serial: number } | null;
  /** De levels (horizontale stramienassen, hoogte in mm) om knopen en platen aan te koppelen. */
  levels?: readonly OpenFem3DLevel[];
  /** Start het kiezen van de overspanning van een belastingvlak in de tekening. */
  onPickLoadPanelSpan?: (panelId: number) => void;
  loadPanelSpanPickActive?: boolean;
  loadCaseOptions?: readonly { id: number; name: string }[];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fem-prop-row"><span className="fem-prop-label">{label}</span><span className="fem-prop-value">{children}</span></div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="fem-prop-section"><div className="fem-prop-section-title">{title}</div>{children}</section>;
}

/**
 * Momentvast en Scharnierend voor één staaf of een selectie. De knop van de
 * situatie die alle gekozen staven hebben, staat aan.
 */
function ReleasePresetButtons({ model, beamIds, onChange }: {
  model: OpenFem3DModel;
  beamIds: readonly number[];
  onChange: (model: OpenFem3DModel) => void;
}) {
  const { t } = useTranslation("ribbon");
  const chosen = model.beams.filter((beam) => beamIds.includes(beam.id));
  if (chosen.length === 0) return null;
  const situaties = chosen.map((beam) => openFem3DReleasePresetOf(beam.releases));
  const actief = situaties.every((situatie) => situatie === situaties[0]) ? situaties[0] : null;
  const toepassen = (preset: OpenFem3DReleasePreset) =>
    onChange(setOpenFem3DReleasePreset(model, chosen.map((beam) => beam.id), preset));
  return <div className="open-fem3d-nc-presets open-fem3d-release-presets" role="group"
    aria-label={t("openFem3d.props.releasePresets")}>
    <button type="button" data-open-fem3d-release-preset="rigid" aria-pressed={actief === "rigid"}
      className={actief === "rigid" ? "active" : undefined}
      onClick={() => toepassen("rigid")}>{t("openFem3d.props.presetRigid")}</button>
    <button type="button" data-open-fem3d-release-preset="pinned" aria-pressed={actief === "pinned"}
      className={actief === "pinned" ? "active" : undefined}
      onClick={() => toepassen("pinned")}>{t("openFem3d.props.presetPinned")}</button>
  </div>;
}

/** Dezelfde namen als de knoopopleggingen. */
const EDGE_SUPPORT_LABELS: Record<(typeof OPEN_FEM_3D_EDGE_SUPPORT_CHOICES)[number], string> = {
  zRoller: "home.zRoller", pinned: "home.pinned", fixed: "home.fixed",
  revoluteX: "openFem3d.revoluteX", revoluteY: "openFem3d.revoluteY", revoluteZ: "openFem3d.revoluteZ",
  xRoller: "home.xRoller", yRoller: "openFem3d.yRoller",
};

const value = (number: number, digits = 3) => Number.isFinite(number) ? number.toFixed(digits) : "—";

/**
 * Keuze "Level": geen, of een van de levels van laag naar hoog met hun hoogte
 * in mm. `mixed` toont bij een meervoudige selectie dat de keuzes verschillen.
 */
function LevelSelect({ value, levels, disabled, mixed = false, onChange }: {
  value: string;
  levels: readonly OpenFem3DLevel[];
  disabled?: boolean;
  mixed?: boolean;
  onChange: (levelId: string) => void;
}) {
  const { t } = useTranslation("ribbon");
  const known = value === "" || levels.some((level) => level.id === value);
  return <select className="fem-prop-input" value={mixed ? "__mixed" : value} disabled={disabled}
    data-open-fem3d-level-select="" onChange={(event) => onChange(event.target.value)}>
    {mixed && <option value="__mixed" disabled>{t("openFem3d.levels.mixed")}</option>}
    <option value="">{t("openFem3d.levels.none")}</option>
    {openFem3DLevelsByHeight(levels).map((level) => <option key={level.id} value={level.id}>
      {t("openFem3d.levels.option", { name: openFem3DLevelName(level), height: toonMm(level.position) })}
    </option>)}
    {!known && <option value={value}>{t("openFem3d.levels.unknown")}</option>}
  </select>;
}

/**
 * Eén knoopcoördinaat wijzigen (meters, zoals het 3D-model rekent). Geeft null
 * als een staaf daardoor geen lengte meer zou hebben: dan verandert er niets.
 * Zet het een staaf op een verticale bedding (k) (bijna) verticaal, dan volgt
 * een OpenFem3DBeddingVerticalError (#106): dezelfde regel als bij het lezen.
 */
export function openFem3DModelWithNodeCoordinate(
  model: OpenFem3DModel, nodeId: number, axis: "x" | "y" | "z", meters: number,
): OpenFem3DModel | null {
  if (!Number.isFinite(meters)) return null;
  const nodes = model.nodes.map((item) => {
    if (item.id !== nodeId) return item;
    const next = { ...item, [axis]: meters };
    // Een andere hoogte maakt de knoop los van zijn level (het paneel laat Z
    // van een gekoppelde knoop niet bewerken; dit houdt de functie zelf eerlijk).
    if (axis !== "z" || item.levelId === undefined || meters === item.z) return next;
    const { levelId: _levelId, ...free } = next;
    return free;
  });
  const byId = new Map(nodes.map((item) => [item.id, item]));
  if (model.beams.some((item) => {
    const a = byId.get(item.startNodeId), b = byId.get(item.endNodeId);
    return a && b && a.x === b.x && a.y === b.y && a.z === b.z;
  })) return null;
  const next = withConsistentOpenFem3DPlateLevels({ ...model, nodes });
  assertOpenFem3DBeddingFitsGeometry(next, model.beams
    .filter((beam) => beam.startNodeId === nodeId || beam.endNodeId === nodeId).map((beam) => beam.id));
  return next;
}

export default function OpenFem3DProperties({
  model, selection, onChange, result, checks, concreteChecks, timberChecks, checksRunning, checksError,
  loadEditorRequest, springEditorRequest, memberLoadEditorRequest, memberPointLoadEditorRequest,
  thermalLoadEditorRequest, activeLoadCaseId = 1, normFocus, levels = [],
  onPickLoadPanelSpan, loadPanelSpanPickActive = false, loadCaseOptions = [],
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
  // Verhoogd als een ingetypte coördinaat geweigerd wordt: dat veld toont dan
  // weer de opgeslagen waarde in plaats van de geweigerde tekst.
  const [coordinateRevision, setCoordinateRevision] = useState({ x: 0, y: 0, z: 0 });
  const [rollDegrees, setRollDegrees] = useState("0");
  // Een geweigerde levelkeuze (bv. een knoop die een plaat op haar level houdt).
  const [levelError, setLevelError] = useState<string | null>(null);
  useEffect(() => { setLevelError(null); }, [selection]);
  // Een geweigerde geometriewijziging (knoop verplaatsen, staaf omhangen), bv.
  // een staaf op een verticale bedding die verticaal zou komen te staan (#106).
  const [geometryError, setGeometryError] = useState<string | null>(null);
  useEffect(() => { setGeometryError(null); }, [selection]);
  const [profileError, setProfileError] = useState<string | null>(null);
  useEffect(() => { setProfileError(null); }, [selection]);
  const refusalText = (reason: unknown) => {
    const bedding = openFem3DBeddingRefusal(reason);
    return bedding ? t(bedding.key, bedding.values) : reason instanceof Error ? reason.message : String(reason);
  };

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
  const timberCheck = beam ? timberChecks?.results.find((item) => item.beam_id === beam.id) : undefined;
  const timberSkip = beam ? timberChecks?.skipped.find((item) => item.beamId === beam.id) : undefined;
  const concreteGoverning = concreteCheck?.checks.find((item) => item.id === concreteCheck.governing_check_id);
  const beamIsConcrete = !!beam && matchSupportedConcreteClass(beam.material) !== null;
  const beamIsTimber = !!beam && matchSupportedTimberGrade(beam.material) !== null;
  const governingCheck = beamCheck ? openFem3DGoverningUlsCheck(beamCheck) : undefined;
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

  /** Koppel of ontkoppel (lege keuze) in één modelwijziging, dus één stap ongedaan maken. */
  const applyLevel = (target: { nodeIds?: readonly number[]; plateIds?: readonly number[] }, levelId: string) => {
    const linked = linkOpenFem3DToLevel(model, target, levelId === "" ? null : levelId, levels);
    if (!linked.ok) {
      const { key, values } = openFem3DLevelRefusalText(linked.refusal, levels);
      setLevelError(t(key, values));
      return;
    }
    setLevelError(null);
    if (linked.model !== model) onChange(linked.model);
  };
  const levelErrorLine = levelError && <p className="open-fem3d-error" role="alert">{levelError}</p>;
  const noLevelsHint = levels.length === 0 && <p className="fem-prop-hint">{t("openFem3d.levels.noLevels")}</p>;

  if (selection?.type === "multi") {
    const multiPlateIds = selection.plateIds ?? [];
    const multiLoadCount = openFem3DSelectionLoadCount(selection);
    const chosen = [
      ...selection.nodeIds.map((id) => model.nodes.find((item) => item.id === id)?.levelId ?? ""),
      ...multiPlateIds.map((id) => model.plates?.find((item) => item.id === id)?.levelId ?? ""),
    ];
    const common = chosen.every((levelId) => levelId === chosen[0]) ? chosen[0] : undefined;
    return <div className="fem-properties"><div className="fem-prop-selection">
      <span className="fem-prop-selection-label">{t("openFem3d.selection", "Selectie")}</span>
      <span className="fem-prop-selection-value">{t("openFem3d.modelCounts", { nodes: selection.nodeIds.length, beams: selection.beamIds.length, plates: selection.plateIds?.length ?? 0 })}</span>
    </div><div className="fem-prop-body"><p className="fem-prop-hint">
      {t("openFem3d.props.multiHint")}
    </p>
    {/* Lasten uit het selectiefilter (issue #94): hoeveel, en in hoeveel gevallen. */}
    {multiLoadCount > 0 && <p className="fem-prop-hint" data-open-fem3d-multi-loads={multiLoadCount}>
      {t("openFem3d.props.multiLoads", {
        count: multiLoadCount, cases: openFem3DSelectieBelastinggevallen(model, openFem3DSelectieIds(selection)!).length,
      })}
    </p>}
    {chosen.length > 0 && <Section title={t("openFem3d.levels.level")}>
      <Row label={t("openFem3d.levels.level")}>
        <LevelSelect value={common ?? ""} mixed={common === undefined} levels={levels} disabled={levels.length === 0}
          onChange={(levelId) => applyLevel({ nodeIds: selection.nodeIds, plateIds: multiPlateIds }, levelId)} />
      </Row>
      <p className="fem-prop-hint">{t("openFem3d.levels.multiHint")}</p>
      {noLevelsHint}
      {levelErrorLine}
    </Section>}
    {selection.beamIds.length > 0 && <Section title={t("openFem3d.props.releasesTitle")}>
      <ReleasePresetButtons model={model} beamIds={selection.beamIds} onChange={onChange} />
      <p className="fem-prop-hint">{t("openFem3d.props.releasePresetsMulti", { count: selection.beamIds.length })}</p>
    </Section>}
    <OpenFem3DTensionOnlyField model={model} beamIds={selection.beamIds} onChange={onChange} />
    <OpenFem3DBeddingField model={model} beamIds={selection.beamIds} onChange={onChange} />
    <OpenFem3DPlateBeddingField model={model} plateIds={multiPlateIds} onChange={onChange} />
    <OpenFem3DDiaphragmFromSelection model={model} nodeIds={selection.nodeIds} onChange={onChange} />
    </div></div>;
  }

  if (selection?.type === "loadPanel" && (model.loadPanels ?? []).some((panel) => panel.id === selection.id)) {
    return <div className="fem-properties" data-open-fem3d-properties={selection.id}>
      <div className="fem-prop-selection">
        <span className="fem-prop-selection-label">{t("openFem3d.selection", "Selectie")}</span>
        <span className="fem-prop-selection-value">{t("openFem3d.props.loadPanelLabel", { id: selection.id })}</span>
      </div>
      <div className="fem-prop-body" key={`loadPanel:${selection.id}`}>
        <OpenFem3DLoadPanelProperties model={model} panelId={selection.id} onChange={onChange}
          onPickSpanDirection={onPickLoadPanelSpan} spanPickActive={loadPanelSpanPickActive}
          loadCaseOptions={loadCaseOptions} />
      </div>
    </div>;
  }

  if (selection?.type === "envelopePanel" && (model.envelopePanels ?? []).some((panel) => panel.id === selection.id)) {
    return <div className="fem-properties" data-open-fem3d-properties={selection.id}>
      <div className="fem-prop-selection">
        <span className="fem-prop-selection-label">{t("openFem3d.selection", "Selectie")}</span>
        <span className="fem-prop-selection-value">{t("tree.envelopePanelLabel", { id: selection.id })}</span>
      </div>
      <div className="fem-prop-body" key={`envelopePanel:${selection.id}`}>
        <OpenFem3DEnvelopePanelProperties model={model} panelId={selection.id} onChange={onChange} />
      </div>
    </div>;
  }

  if (!selection || (!node && !beam && !plate)) {
    return <div className="fem-properties fem-properties-empty"><p>{t("openFem3d.selectForProperties", "Selecteer een 3D-knoop, staaf, plaat of belasting om de eigenschappen te bekijken.")}</p></div>;
  }

  const nodeHeldBy = node ? openFem3DPlateHoldingNode(model, node.id) : null;
  const levelName = (levelId: string | undefined) => {
    const level = levels.find((item) => item.id === levelId);
    return level ? openFem3DLevelName(level) : levelId ?? "";
  };

  const applyCoordinate = (axis: "x" | "y" | "z", meters: number) => {
    if (!node) return;
    let next: OpenFem3DModel | null = null;
    try {
      next = openFem3DModelWithNodeCoordinate(model, node.id, axis, meters);
      setGeometryError(null);
    } catch (reason) {
      setGeometryError(refusalText(reason));
    }
    if (next) onChange(next);
    else setCoordinateRevision((revision) => ({ ...revision, [axis]: revision[axis] + 1 }));
  };
  const applyBeamNodes = (beamId: number, startNodeId: number, endNodeId: number) => {
    try {
      onChange(setOpenFem3DBeamNodes(model, beamId, startNodeId, endNodeId));
      setGeometryError(null);
    } catch (reason) {
      setGeometryError(refusalText(reason));
    }
  };
  const geometryErrorLine = geometryError
    && <p className="open-fem3d-error" role="alert" data-open-fem3d-geometry-error>{geometryError}</p>;

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
    onChange(flipOpenFem3DBeamLocalAxes(model, beam.id));
  };

  const selectionLabel = selection.type === "nodalLoad" ? t("openFem3d.props.nodalLoadLabel", { id: selection.id })
    : selection.type === "memberLoad" ? t("openFem3d.props.memberLoadLabel", { id: selection.id })
    : selection.type === "memberPointLoad" ? t("openFem3d.props.memberPointLoadLabel", { id: selection.id })
    : selection.type === "thermalLoad" ? t("openFem3d.props.thermalLoadLabel", { id: selection.id })
    : selection.type === "surfaceLoad" ? t("openFem3d.props.surfaceLoadLabel", { id: selection.id })
    : selection.type === "plate" ? t("openFem3d.props.plateLabel", { id: selection.id })
    : selection.type === "node" ? t("openFem3d.editNode", { id: selection.id })
    : t("openFem3d.editBeam", { id: selection.id });

  return <div className="fem-properties" data-open-fem3d-properties={selection.id}>
    <div className="fem-prop-selection">
      <span className="fem-prop-selection-label">{t("openFem3d.selection", "Selectie")}</span>
      <span className="fem-prop-selection-value">{selectionLabel}</span>
    </div>
    <div className="fem-prop-tabs">
      <button className={`fem-prop-tab${tab === "general" ? " active" : ""}`} onClick={() => setTab("general")}>{t("openFem3d.general", "Algemeen")}</button>
      <button className={`fem-prop-tab${tab === "results" ? " active" : ""}`} onClick={() => setTab("results")}>{t("openFem3d.results")}</button>
      {beam && <button className={`fem-prop-tab${tab === "norm" ? " active" : ""}`} onClick={() => setTab("norm")}>{beamIsConcrete ? "EN 1992" : beamIsTimber ? "EN 1995" : "EN 1993"}</button>}
    </div>

    <div className="fem-prop-body" key={`${selection.type}:${selection.id}:${tab}`}>
      {tab === "general" && node && <>
        <Section title={t("openFem3d.geometry", "Geometrie")}>
          <Row label="ID"><code>{node.id}</code></Row>
          {/* Invoer in mm (issue #36); het 3D-model bewaart meters. Z van een
              knoop op een level volgt dat level en is hier niet te bewerken. */}
          {(["x", "y", "z"] as const).map((axis) => <Row key={axis} label={`${axis.toUpperCase()} (mm)`}>
            <LengthInput key={`${axis}-${coordinateRevision[axis]}`} className="fem-prop-input" storedUnit="m"
              required min={-Infinity} value={node[axis]} disabled={axis === "z" && node.levelId !== undefined}
              onChange={(meters) => { if (meters !== undefined) applyCoordinate(axis, meters); }} />
          </Row>)}
          {geometryErrorLine}
          <Row label={t("openFem3d.levels.level")}>
            <LevelSelect value={node.levelId ?? ""} levels={levels}
              disabled={nodeHeldBy !== null || (levels.length === 0 && node.levelId === undefined)}
              onChange={(levelId) => applyLevel({ nodeIds: [node.id] }, levelId)} />
          </Row>
          {nodeHeldBy
            ? <p className="fem-prop-hint">{t("openFem3d.levels.viaPlate", { plate: nodeHeldBy.id, level: levelName(nodeHeldBy.levelId) })}</p>
            : node.levelId !== undefined && <p className="fem-prop-hint">{t("openFem3d.levels.zFollows")}</p>}
          {noLevelsHint}
          {levelErrorLine}
          <OpenFem3DNodeDiaphragmRow model={model} nodeId={node.id} />
        </Section>
        <OpenFem3DNodeConditions model={model} nodeId={node.id} onChange={onChange}
          loadEditorRequest={loadEditorRequest} springEditorRequest={springEditorRequest}
          activeLoadCaseId={activeLoadCaseId}
          selectedLoadId={selection.type === "nodalLoad" ? selection.id : undefined} />
      </>}

      {tab === "general" && beam && <>
        <Section title={t("openFem3d.geometry", "Geometrie")}>
          <Row label="ID"><code>{beam.id}</code></Row>
          <Row label={t("openFem3d.props.memberName")}><input
            key={`${beam.id}:${beam.name ?? ""}`} className="fem-prop-input" type="text"
            defaultValue={beam.name ?? ""}
            onBlur={(event) => {
              const naam = event.currentTarget.value.trim();
              if (naam === (beam.name ?? "")) return;
              try {
                onChange(updateOpenFem3DBeam(model, beam.id, { name: naam || null }));
                setGeometryError(null);
              } catch (reason) { setGeometryError(refusalText(reason)); }
            }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          /></Row>
          <p className="fem-prop-hint">{t("openFem3d.props.memberNameHint")}</p>
          <Row label={t("openFem3d.startNode")}><select className="fem-prop-input" value={beam.startNodeId}
            onChange={(event) => applyBeamNodes(beam.id, Number(event.target.value), beam.endNodeId)}>
            {model.nodes.map((candidate) => <option key={candidate.id} value={candidate.id}
              disabled={candidate.id === beam.endNodeId || (
                candidate.x === beamGeometry?.end.x && candidate.y === beamGeometry?.end.y && candidate.z === beamGeometry?.end.z
              )}>K{candidate.id} ({toonMm(candidate.x, "m")}, {toonMm(candidate.y, "m")}, {toonMm(candidate.z, "m")})</option>)}
          </select></Row>
          <Row label={t("openFem3d.endNode")}><select className="fem-prop-input" value={beam.endNodeId}
            onChange={(event) => applyBeamNodes(beam.id, beam.startNodeId, Number(event.target.value))}>
            {model.nodes.map((candidate) => <option key={candidate.id} value={candidate.id}
              disabled={candidate.id === beam.startNodeId || (
                candidate.x === beamGeometry?.start.x && candidate.y === beamGeometry?.start.y && candidate.z === beamGeometry?.start.z
              )}>K{candidate.id} ({toonMm(candidate.x, "m")}, {toonMm(candidate.y, "m")}, {toonMm(candidate.z, "m")})</option>)}
          </select></Row>
          <Row label={t("openFem3d.length", "Lengte")}><code>{toonMm(beamGeometry?.length ?? 0, "m")} mm</code></Row>
          {geometryErrorLine}
        </Section>
        <Section title={t("openFem3d.crossSection", "Profiel en materiaal")}>
          {/* Een verlopende staaf (#73) heet zoals in 2D: "IPE 500 → IPE 300 (verlopend)". */}
          <Row label={t("openFem3d.profile")}><code data-open-fem3d-profile>
            {beam.profileName ? doorsnedeNaamVertaald(openFem3DBeamAls2D(beam), t) : "—"} — {beam.material || "—"}
          </code></Row>
          <div className="fem-prop-kiezer-row"><button className="fem-prop-kiezer-btn" onClick={() => setProfileOpen(true)}>{t("openFem3d.chooseProfile", "Profiel kiezen…")}</button></div>
          {profileError && <p className="open-fem3d-error" role="alert">{profileError}</p>}
          {profileOpen && <ProfielKiezer
            open
            onClose={() => setProfileOpen(false)}
            huidig={{
              material: beam.material ?? "S235", profile: beam.profileName ?? "IPE 200",
              ...(beam.profileNameEnd ? { profileEnd: beam.profileNameEnd } : {}),
            }}
            huidigBeton={{
              ...(beam.checkConfig?.betonKorf ? { korf: beam.checkConfig.betonKorf } : {}),
              ...(beam.checkConfig?.betonMilieuklasse ? { milieuklasse: beam.checkConfig.betonMilieuklasse } : {}),
              ...(beam.checkConfig?.betonConstructieklasse ? { constructieklasse: beam.checkConfig.betonConstructieklasse } : {}),
            }}
            onApply={(choice) => {
              // Materiaal, profiel én eindprofiel (verlopend, #73): dezelfde
              // zuivere functie als model3d.beam.update; een prismatische keuze
              // haalt een eerder eindprofiel weg.
              try {
                onChange(applyOpenFem3DProfileChoice(model, [beam.id], choice));
                setProfileError(null);
              } catch (reason) {
                setProfileError(refusalText(reason));
              }
              setProfileOpen(false);
            }}
          />}
          {beamIsConcrete && beam.material && <OpenFem3DAnalysisMaterialField
            model={model} material={beam.material} onChange={onChange} />}
          <label className="fem-prop-hint">
            <input type="checkbox" data-open-fem3d-shear-deformation
              checked={beam.shearDeformation ?? false}
              onChange={(event) => updateBeam({ shearDeformation: event.target.checked })} />{" "}
            {t("openFem3d.props.shearDeformation")}
          </label>
          <p className="fem-prop-hint">{t("openFem3d.props.shearDeformationHint")}</p>
        </Section>
        <Section title={t("openFem3d.localAxesAndReleases", "Lokale assen en eindscharnieren")}>
          <Row label={t("openFem3d.rollAngle", "Profielrotatie")}>
            <span className="open-fem3d-roll-input"><input className="fem-prop-input" type="number" step="any"
              value={rollDegrees} onChange={(event) => setRollDegrees(event.target.value)}
              onBlur={applyRoll} onKeyDown={(event) => { if (event.key === "Enter") { applyRoll(); event.currentTarget.blur(); } }} /> °</span>
          </Row>
          <div className="fem-prop-kiezer-row"><button type="button" className="fem-prop-kiezer-btn" onClick={flipLocalAxes}>{t("openFem3d.props.flipAxes")}</button></div>
          <p className="fem-prop-hint">{t("openFem3d.props.releasesHint")}</p>
          <ReleasePresetButtons model={model} beamIds={[beam.id]} onChange={onChange} />
          <div className="open-fem3d-release-grid">
            {([
              "myStart", "myEnd", "mzStart", "mzEnd", "torsionStart", "torsionEnd",
            ] as const).map((key) => <label key={key}>
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
              <span>{t(`openFem3d.props.${key}`)}</span>
            </label>)}
          </div>
        </Section>
        <OpenFem3DTensionOnlyField model={model} beamIds={[beam.id]} onChange={onChange} />
        <OpenFem3DBeddingField model={model} beamIds={[beam.id]} onChange={onChange} />
        <OpenFem3DMemberLoads model={model} beamId={beam.id} lengthM={beamGeometry?.length ?? 0}
          onChange={onChange} editorRequest={memberLoadEditorRequest} pointEditorRequest={memberPointLoadEditorRequest}
          thermalEditorRequest={thermalLoadEditorRequest}
          selectedLoad={selection.type === "memberLoad" || selection.type === "memberPointLoad" || selection.type === "thermalLoad"
            ? { kind: selection.type, id: selection.id }
            : undefined}
          activeLoadCaseId={activeLoadCaseId} />
      </>}

      {tab === "general" && plate && <>
        <Section title={t("openFem3d.props.plateGeometry")}>
          <Row label="ID"><code>{plate.id}</code></Row>
          <Row label={plate.boundary ? t("openFem3d.props.contourNodes") : t("openFem3d.props.cornerNodes")}><code>{plate.nodeIds.map((id) => `K${id}`).join(" · ")}</code></Row>
          {plate.boundary && <Row label={t("openFem3d.props.edgeSegments")}><code>{t("openFem3d.props.edgeSegmentsValue", { segments: plate.boundary.length, arcs: plate.boundary.filter((segment) => segment.kind === "arc").length })}</code></Row>}
          {(plate.openings ?? []).some((opening) => opening.boundary?.some((segment) => segment.kind === "arc")) &&
            <Row label={t("openFem3d.props.openingArcs")}><code>{(plate.openings ?? []).reduce((count, opening) =>
              count + (opening.boundary?.filter((segment) => segment.kind === "arc").length ?? 0), 0)}</code></Row>}
          {/* Dikte en randstraal in mm (issue #36); het 3D-model bewaart meters. */}
          <Row label={t("openFem3d.props.thicknessMm")}><LengthInput className="fem-prop-input" storedUnit="m"
            required positive value={plate.thicknessM}
            onChange={(meters) => { if (meters !== undefined) onChange(updateOpenFem3DPlate(model, plate.id, { thicknessM: meters })); }} /></Row>
          {/* Leegmaken betekent geen afronding (0), zoals voorheen. */}
          <Row label={t("openFem3d.props.cornerRadiusMm")}><LengthInput className="fem-prop-input" storedUnit="m"
            value={plate.cornerRadiusM ?? 0}
            onChange={(meters) => {
              const radius = meters ?? 0;
              if (radius !== (plate.cornerRadiusM ?? 0)) onChange(updateOpenFem3DPlate(model, plate.id, { cornerRadiusM: radius }));
            }} /></Row>
          <Row label={t("openFem3d.material")}><input className="fem-prop-input" defaultValue={plate.material ?? "C30/37"}
            key={`material-${plate.id}-${plate.material}`}
            onBlur={(event) => onChange(updateOpenFem3DPlate(model, plate.id, { material: event.currentTarget.value.trim() || "C30/37" }))} /></Row>
          {plate.material && <OpenFem3DAnalysisMaterialField model={model} material={plate.material} onChange={onChange} />}
          <Row label={t("openFem3d.props.openings")}><code>{plate.openings?.length ?? 0}</code></Row>
          <Row label={t("openFem3d.levels.level")}>
            <LevelSelect value={plate.levelId ?? ""} levels={levels}
              disabled={levels.length === 0 && plate.levelId === undefined}
              onChange={(levelId) => applyLevel({ plateIds: [plate.id] }, levelId)} />
          </Row>
          <p className="fem-prop-hint">{t("openFem3d.levels.plateHint")}</p>
          {noLevelsHint}
          {levelErrorLine}
          {/* Elementgrootte van het rekennet in mm; leeg = automatisch. */}
          <Row label={t("openFem3d.props.meshSizeMm")}><LengthInput className="fem-prop-input" storedUnit="m"
            positive min={10} value={plate.meshSizeM ?? null}
            data-open-fem3d-mesh-size={plate.id}
            onChange={(meters) => {
              if (meters !== plate.meshSizeM) onChange(updateOpenFem3DPlate(model, plate.id, { meshSizeM: meters }));
            }} /></Row>
          <p className="fem-prop-hint">{t("openFem3d.props.meshSizeHint")}</p>
        </Section>
        {/* Lijnopleggingen langs de randen van de buitencontour. */}
        <Section title={t("openFem3d.props.edgeSupports")}>
          {openFem3DPlateEdges(plate).map((edge) => {
            const current = plate.edgeSupports?.find((item) => item.edge === edge.index);
            const preset = current ? openFem3DSupportPresetOf(current) : "none";
            const label = t(edge.controlNodeId === undefined ? "openFem3d.props.edgeLabel" : "openFem3d.props.edgeArcLabel",
              { index: edge.index + 1, from: edge.startNodeId, to: edge.endNodeId });
            return <Row key={edge.index} label={label}>
              <select className="fem-prop-input" value={preset} aria-label={label}
                data-open-fem3d-edge-support={`${plate.id}:${edge.index}`}
                onChange={(event) => {
                  const choice = event.currentTarget.value;
                  if (choice === "custom") return;
                  onChange(updateOpenFem3DPlate(model, plate.id, {
                    edgeSupports: withOpenFem3DPlateEdgeSupport(plate.edgeSupports, edge.index,
                      choice === "none" ? null : choice as OpenFem3DSupportPreset),
                  }));
                }}>
                <option value="none">{t("openFem3d.free")}</option>
                {OPEN_FEM_3D_EDGE_SUPPORT_CHOICES.map((choice) => <option key={choice} value={choice}>
                  {t(EDGE_SUPPORT_LABELS[choice])}
                </option>)}
                {preset === "custom" && <option value="custom" disabled>{t("openFem3d.props.edgeSupportCustom")}</option>}
              </select>
            </Row>;
          })}
          <p className="fem-prop-hint">{t("openFem3d.props.edgeSupportsHint")}</p>
        </Section>
        {/* Plaat op bedding (#107): k en alleen druk; de kern zet de grondveren. */}
        <OpenFem3DPlateBeddingField model={model} plateIds={[plate.id]} onChange={onChange} />
        <Section title={t("openFem3d.props.surfaceLoads")}>
          {(model.surfaceLoads ?? []).filter((load) => load.plateId === plate.id).length === 0 && <p className="fem-prop-hint">{t("openFem3d.props.surfaceLoadHint")}</p>}
          {surfaceLoad && <>
            {(["qx", "qy", "qz"] as const).map((axis) => <Row key={axis} label={`${axis} (kN/m²)`}>
              <input className="fem-prop-input" type="number" step="any" defaultValue={surfaceLoad[axis]}
                key={`${surfaceLoad.id}-${axis}-${surfaceLoad[axis]}`}
                onBlur={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChange(updateOpenFem3DSurfaceLoad(model, surfaceLoad.id, { qx: surfaceLoad.qx, qy: surfaceLoad.qy, qz: surfaceLoad.qz, [axis]: next }));
                }} />
            </Row>)}
            <button className="open-fem3d-delete" type="button" onClick={() => onChange(removeOpenFem3DSurfaceLoad(model, surfaceLoad.id))}>{t("openFem3d.props.deleteSurfaceLoad")}</button>
          </>}
        </Section>
      </>}

      {tab === "results" && <>
        {!result && <p className="fem-prop-hint">{t("openFem3d.readyToCalculate")}</p>}
        {plate && result && (() => {
          const extremes = openFem3DPlateExtremes(result, plate.id);
          const summary = result.plates?.find((item) => item.plateId === plate.id);
          const meshInfo = result.plateMesh?.plates.find((item) => item.plateId === plate.id);
          if (!summary) return null;
          const axis = (v: readonly number[]) => `(${v.map((c) => formatOpenFem3DPlateValue(Math.abs(c) < 1e-12 ? 0 : c)).join("; ")})`;
          return <Section title={t("openFem3d.props.plateResults")}>
            {meshInfo && <Row label={t("openFem3d.props.plateMesh")}><code>{t("openFem3d.props.plateMeshValue", {
              count: meshInfo.elementCount, size: Math.round(meshInfo.meshSizeM * 1000),
              method: t(meshInfo.method === "raster" ? "openFem3d.props.meshRaster" : "openFem3d.props.meshTriangles"),
            })}</code></Row>}
            <Row label={t("openFem3d.props.plateAxes")}><code>x {axis(summary.axes.x)} · z {axis(summary.axes.z)}</code></Row>
            <table className="open-fem3d-plate-extremes" data-open-fem3d-plate-extremes={plate.id}>
              <thead><tr><th /><th>{t("openFem3d.props.resultMin")}</th><th>{t("openFem3d.props.resultMax")}</th><th /></tr></thead>
              <tbody>{extremes.map((item) => <tr key={item.definition.key} title={t(`openFem3dPlate.quantity.${item.definition.key}`, { ns: "common" })}>
                <th>{item.definition.symbol}</th>
                <td>{formatOpenFem3DPlateValue(item.min)}</td>
                <td>{formatOpenFem3DPlateValue(item.max)}</td>
                <td>{item.definition.unit}</td>
              </tr>)}</tbody>
            </table>
            <p className="fem-prop-hint">{t("openFem3dPlate.signNote", { ns: "common" })}</p>
          </Section>;
        })()}
        {plate && result && <OpenFem3DPlateBeddingResults model={model} plateId={plate.id} result={result} />}
        {node && displacement && <Section title={t("openFem3d.displacements", "Knoopverplaatsingen")}>
          <Row label="Ux"><code>{value(displacement.ux * 1000)} mm</code></Row><Row label="Uy"><code>{value(displacement.uy * 1000)} mm</code></Row><Row label="Uz"><code>{value(displacement.uz * 1000)} mm</code></Row>
          <Row label="Rx"><code>{value(displacement.rx, 6)} rad</code></Row><Row label="Ry"><code>{value(displacement.ry, 6)} rad</code></Row><Row label="Rz"><code>{value(displacement.rz, 6)} rad</code></Row>
        </Section>}
        {node && reaction && <Section title={t("openFem3d.reactions", "Oplegreacties")}>
          <Row label="Fx"><code>{value(reaction.fx)} kN</code></Row><Row label="Fy"><code>{value(reaction.fy)} kN</code></Row><Row label="Fz"><code>{value(reaction.fz)} kN</code></Row>
          <Row label="Mx"><code>{value(reaction.mx)} kNm</code></Row><Row label="My"><code>{value(reaction.my)} kNm</code></Row><Row label="Mz"><code>{value(reaction.mz)} kNm</code></Row>
        </Section>}
        {beam && result && (() => {
          // Trek-alleen in deze uitkomst: inactief, actief dankzij de
          // kruisregel, en de montageverlenging Δ0 als het verband na de
          // permanente belasting is gemonteerd.
          const inactive = result.inactiveMembers?.includes(beam.id) ?? false;
          const crossRule = result.crossRuleMembers?.includes(beam.id) ?? false;
          const fit = result.tensionOnlyFit?.find((item) => item.memberId === beam.id);
          if (!inactive && !crossRule && !fit) return null;
          return <Section title={t("openFem3d.trekSchijf.tensionOnlyTitle")}>
            {inactive && <p className="fem-prop-hint open-fem3d-inactive-note" data-open-fem3d-inactive-member={beam.id}>{t("openFem3d.trekSchijf.inactive")}</p>}
            {crossRule && <p className="fem-prop-hint" data-open-fem3d-cross-rule-member={beam.id}>{t("openFem3d.trekSchijf.crossRuleKept")}</p>}
            {fit && <Row label={t("openFem3d.trekSchijf.fitDelta")}><code data-open-fem3d-fit-delta={beam.id}>{value(fit.deltaMm)} mm</code></Row>}
            {fit && <p className="fem-prop-hint">{t("openFem3d.trekSchijf.fitDeltaHint")}</p>}
          </Section>;
        })()}
        {beam && result && <OpenFem3DBeddingResults model={model} beamId={beam.id} result={result} />}
        {beam && memberForces && <Section title={t("openFem3d.memberForces", "Staafkrachten begin / eind")}>
          <Row label="N"><code>{value(memberForces.nStartKn)} / {value(memberForces.nEndKn)} kN</code></Row>
          <Row label="Vy"><code>{value(memberForces.vyStartKn)} / {value(memberForces.vyEndKn)} kN</code></Row>
          <Row label="Vz"><code>{value(memberForces.vzStartKn)} / {value(memberForces.vzEndKn)} kN</code></Row>
          <Row label="T"><code>{value(memberForces.torsionStartKnm)} / {value(memberForces.torsionEndKnm)} kNm</code></Row>
          <Row label="My"><code>{value(memberForces.myStartKnm)} / {value(memberForces.myEndKnm)} kNm</code></Row>
          <Row label="Mz"><code>{value(memberForces.mzStartKnm)} / {value(memberForces.mzEndKnm)} kNm</code></Row>
        </Section>}
      </>}

      {tab === "norm" && beam && <>
        <Section title={t("openFem3d.stability", "Stabiliteit")}>
          <Row label="αcr"><code>{result?.buckling.status === "available" ? value(result.buckling.modes[0]?.loadFactor ?? NaN) : "—"}</code></Row>
          <Row label="Lcr"><code>{buckling ? `${value(buckling.effectiveLengthM)} m` : "—"}</code></Row>
          <Row label={result?.principalAxesMemberIds?.includes(beam.id) ? "λu" : "λy"}><code>{buckling ? value(buckling.slendernessY) : "—"}</code></Row>
          <Row label={result?.principalAxesMemberIds?.includes(beam.id) ? "λv" : "λz"}><code>{buckling ? value(buckling.slendernessZ) : "—"}</code></Row>
        </Section>
        {beamIsConcrete && <Section title={t("openFem3d.props.columnSection")}>
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
            idPrefix={`open-fem3d-column-${beam.id}`}
          />
        </Section>}
        {!beamIsConcrete && !beamIsTimber && <Section title={t("openFem3d.props.steelUlsSection")}>
          {checksRunning && <p className="fem-prop-hint">{t("openFem3d.props.steelRunning")}</p>}
          {checksError && <p className="open-fem3d-error" role="alert">{checksError}</p>}
          {!checksRunning && !checksError && !beamCheck && <p className="fem-prop-hint">
            {checkSkip?.reason ?? (result ? t("openFem3d.props.noSteelCheck") : t("openFem3d.props.calculateFirst"))}
          </p>}
          {beamCheck && beamCheck.status === "NotApplicable" && <>
            {/* Niet (volledig) getoetst: geen "voldoet" en geen UC, maar de
                reden van de kern (controle 2026-10, punt B7). */}
            <Row label={t("openFem3d.check.status")}><strong className="open-fem3d-check-na" data-open-fem3d-niet-getoetst>
              {t("openFem3d.check.notChecked")}
            </strong></Row>
            <Row label={t("openFem3d.check.ucUls")}><code>—</code></Row>
            <p className="fem-prop-hint">{t("openFem3d.check.notCheckedReason", { reason: beamCheck.governing_check_id })}</p>
          </>}
          {beamCheck && beamCheck.status !== "NotApplicable" && <>
            <Row label={t("openFem3d.check.status")}><strong className={openFem3DUlsUc(beamCheck) <= 1 ? "open-fem3d-check-ok" : "open-fem3d-check-not-ok"}>
              {openFem3DUlsUc(beamCheck) <= 1 ? t("openFem3d.check.pass") : t("openFem3d.check.fail")}
            </strong></Row>
            <Row label={t("openFem3d.check.ucUls")}><code>{value(openFem3DUlsUc(beamCheck))}</code></Row>
            <Row label={t("openFem3d.check.governing")}><code>{governingCheck?.kind.data.title ?? "—"}</code></Row>
            <Row label={t("openFem3d.check.article")}><code>{governingCheck?.kind.data.article ?? "—"}</code></Row>
            <Row label={t("openFem3d.check.class")}><code>{beamCheck.classification}</code></Row>
            <div className="open-fem3d-check-list">
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
        {beamIsTimber && <Section title={t("openFem3d.props.timberUlsSection")}>
          {checksRunning && <p className="fem-prop-hint">{t("openFem3d.props.steelRunning")}</p>}
          {checksError && <p className="open-fem3d-error" role="alert">{checksError}</p>}
          {!checksRunning && !checksError && !timberCheck && <p className="fem-prop-hint">
            {timberSkip?.reason ?? (result ? t("openFem3d.props.noTimberCheck") : t("openFem3d.props.calculateFirst"))}
          </p>}
          {timberCheck && <>
            <Row label={t("openFem3d.check.ucUls")}><code>{value(openFem3DTimberUlsUc(timberCheck))}</code></Row>
            <Row label={t("openFem3d.check.governing")}><code>{openFem3DTimberGoverningUlsCheck(timberCheck)?.id ?? "—"}</code></Row>
            <div className="open-fem3d-check-list">
              {timberCheck.checks.filter((check) => !check.id.startsWith("deflection_") && check.kind.data.uc)
                .sort((a, b) => (checkUc(b) ?? 0) - (checkUc(a) ?? 0))
                .map((check) => <div key={check.id}><span>{check.kind.data.title}</span><code>{value(checkUc(check) ?? 0)}</code></div>)}
            </div>
          </>}
        </Section>}
        {beamIsConcrete && <Section title={t("openFem3d.props.concreteUlsSection")}>
          {checksRunning && <p className="fem-prop-hint">{t("openFem3d.props.concreteRunning")}</p>}
          {checksError && <p className="open-fem3d-error" role="alert">{checksError}</p>}
          {!checksRunning && !checksError && !concreteCheck && <p className="fem-prop-hint">
            {concreteSkip?.reason ?? (result ? t("openFem3d.props.noConcreteCheck") : t("openFem3d.props.calculateFirst"))}
          </p>}
          {concreteCheck && <>
            <Row label={t("openFem3d.check.status")}><strong className={concreteCheck.status === "Ok" ? "open-fem3d-check-ok" : "open-fem3d-check-not-ok"}>
              {concreteCheck.status === "Ok" ? t("openFem3d.check.pass") : concreteCheck.status === "NotOk" ? t("openFem3d.check.fail") : t("openFem3d.check.incomplete")}
            </strong></Row>
            <Row label={t("openFem3d.check.ucUls")}><code>{value(concreteCheck.uc_max)}</code></Row>
            <Row label={t("openFem3d.check.governing")}><code>{concreteGoverning?.kind.data.title ?? concreteCheck.governing_check_id}</code></Row>
            <Row label={t("openFem3d.check.article")}><code>{concreteGoverning?.kind.data.article ?? "—"}</code></Row>
            <Row label={t("openFem3d.check.section")}><code>{concreteCheck.section_name}</code></Row>
            <Row label={t("openFem3d.check.reinforcement")}><code>{concreteCheck.reinforcement_summary}</code></Row>
            {concreteCheck.niet_uitgevoerd.length > 0 && <Row label={t("openFem3d.check.notPerformed")}><code>{concreteCheck.niet_uitgevoerd.length}</code></Row>}
            <div className="open-fem3d-check-list">
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
          ? t("openFem3d.props.concreteNormBasis")
          : t("openFem3d.normBasis", "De EN 1993-toets gebruikt alle zes lokale staafkrachten. Kniklengtes vallen terug op L en expliciete 3D-kipsteunen ontbreken nog. De eigenwaarde-knikfactor hierboven controleert apart de globale stabiliteit.")}</p>
      </>}
    </div>
  </div>;
}
