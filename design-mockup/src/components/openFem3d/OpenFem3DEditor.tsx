import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ThreeFrameCanvas from "./ThreeFrameCanvas";
import OpenFem3DVisibilityDialog from "./OpenFem3DVisibilityDialog";
import { readOpenFem3DVisibility, saveOpenFem3DVisibility, type OpenFem3DVisibility } from "./openFem3dVisibility";
import type { OpenFem3DTool, OpenFem3DView } from "./openFem3dCommands";
import { verwerkToets, type Prefix } from "../../lib/commandoReeks";
import {
  openFem3DLoadCaseId,
  removeOpenFem3DSelection,
  type OpenFem3DModel,
} from "./openFem3dModel";
import { isInvoerVeld } from "../../lib/escapeToets";
import { erIsEenDialoogOpen } from "../Modal";
import type { StructuralGrid } from "../fem/femTypes";
import { OPEN_FEM_3D_PLATES_LINEAR_NOTICE, openFem3DPlateMeshFor, type OpenFem3DSolveResult } from "./openFem3dSolver";
import type { OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import {
  formatOpenFem3DPlateValue, openFem3DContourGradientCss, openFem3DPlateQuantity, openFem3DPlateQuantityRange,
  type OpenFem3DPlateQuantity,
} from "./openFem3dPlateResults";
import { openFem3DMaximumDisplacementM } from "./openFem3dDisplacement";
import type { OpenFem3DSteelChecks } from "./openFem3dSteelCheck";
import type { OpenFem3DConcreteChecks } from "./openFem3dConcreteCheck";
import { buildOpenFem3DUtilizations } from "./openFem3dUtilization";
import OpenFem3DTransformPanel from "./OpenFem3DTransformPanel";
import { transformOpenFem3D, type OpenFem3DTransformCommand } from "./openFem3dTransform";
import { openFem3DSelectionCount, type OpenFem3DSelection } from "./openFem3dSelection";
import type { OpenFem3DCameraState, OpenFem3DViewSet } from "./openFem3dViewSets";
import type { OpenFem3DEditMeta } from "./openFem3dHistory";
import type { OpenFem3DNodeTarget } from "./openFem3dNodeTools";
import type { OpenFem3DDeformationDisplay } from "./openFem3dDeformationDisplay";
import { openFem3DWorkLevel, openFem3DWorkPlaneIsHorizontal, openFem3DWorkPlaneOptions } from "./openFem3dWorkPlane";
import { openFem3DLevelName } from "./openFem3dLevels";
import { toonMm } from "../../lib/lengthInput";
import { openFem3DProfielKleuring, profielKleurenActief3d } from "../../lib/profielKleur";
import ProfielKleurLegenda from "../fem/ProfielKleurLegenda";
import "./OpenFem3DEditor.css";

const DRAW_HELP_KEYS: Partial<Record<OpenFem3DTool, string>> = {
  addNode: "openFem3d.nodeHelp",
  addBeam: "openFem3d.beamHelp",
  addPlate: "openFem3d.plateHelp",
  addPlateArc: "openFem3d.plateArcHelp",
  addOpening: "openFem3d.openingHelp",
  addOpeningArc: "openFem3d.openingArcHelp",
  addMemberLoad: "openFem3d.memberLoadPlacementHelp",
  addLoadPanel: "openFem3d.loadPanelHelp",
  loadPanelSpan: "openFem3d.loadPanelSpanHelp",
};

interface Props {
  model: OpenFem3DModel;
  calculationModel?: OpenFem3DModel;
  onChange: (model: OpenFem3DModel, meta?: OpenFem3DEditMeta) => void;
  visibilityOpen?: boolean;
  onVisibilityOpen?: () => void;
  onVisibilityClose?: () => void;
  tool?: OpenFem3DTool;
  onToolChange?: (tool: OpenFem3DTool) => void;
  /** Oplegging- of veergereedschap: klik op een knoop of in leeg canvas (werkvlak). */
  onPlaceNodeCondition?: (target: OpenFem3DNodeTarget) => void;
  /** Vergroting van de vervormde vorm en het onvervormde model erachter. */
  deformationDisplay?: OpenFem3DDeformationDisplay;
  deleteToken?: number;
  fitRequest?: number;
  viewRequest?: { kind: OpenFem3DView; token: number };
  onCameraViewChange?: (view: OpenFem3DView) => void;
  initialCamera?: OpenFem3DCameraState | null;
  onCameraStateChange?: (state: OpenFem3DCameraState) => void;
  selection?: OpenFem3DSelection;
  onSelectionChange?: (selection: OpenFem3DSelection) => void;
  onOpenCheckForBeam?: (beamId: number) => void;
  visibility?: OpenFem3DVisibility;
  onVisibilityChange?: (visibility: OpenFem3DVisibility) => void;
  showLoadCase?: boolean;
  resultsActive?: boolean;
  structuralGrid?: StructuralGrid;
  gridSpacingM?: number;
  result?: OpenFem3DSolveResult | null;
  /** Grootheid van de plaatcontour; `null` = geen contour. */
  plateQuantity?: OpenFem3DPlateQuantity | null;
  checks?: OpenFem3DSteelChecks | null;
  concreteChecks?: OpenFem3DConcreteChecks | null;
  solving?: boolean;
  solveError?: string | null;
  activeLoadCaseId?: number;
  viewSets?: OpenFem3DViewSet[];
  currentView?: OpenFem3DView;
  currentCombinationId?: number | null;
  combinationOptions?: { id: number; name: string }[];
  loadCaseOptions?: { id: number; name: string }[];
  onViewSetsChange?: (viewSets: OpenFem3DViewSet[]) => void;
  onApplyViewSet?: (viewSet: OpenFem3DViewSet) => void;
  /** Een camera van buiten (een eigen view uit de verkenner, tab Views); elke nieuwe token past hem toe. */
  cameraVerzoek?: { state: OpenFem3DCameraState; token: number };
  /** Soort per belastinggeval, voor de kleur van de lastvlakken. */
  loadCaseTypes?: ReadonlyMap<number, string>;
}

/** Canvas only: 3D uses the shared ribbon, Explorer and Properties panels. */
export default function OpenFem3DEditor({
  model, calculationModel, onChange, visibilityOpen = false, onVisibilityOpen, onVisibilityClose,
  tool = "select", onToolChange, onPlaceNodeCondition, deformationDisplay, deleteToken = 0, fitRequest = 0, viewRequest, onCameraViewChange,
  initialCamera, onCameraStateChange,
  selection: controlledSelection, onSelectionChange, onOpenCheckForBeam,
  visibility: visibilityProp, onVisibilityChange, showLoadCase = true, resultsActive = false, structuralGrid, gridSpacingM,
  result = null, plateQuantity = null, checks = null, concreteChecks = null,
  solving = false, solveError = null, activeLoadCaseId,
  viewSets = [], currentView = "iso", currentCombinationId = null, combinationOptions = [], loadCaseOptions = [],
  onViewSetsChange, onApplyViewSet, cameraVerzoek, loadCaseTypes,
}: Props) {
  const { t } = useTranslation("ribbon");
  const [internalSelection, setInternalSelection] = useState<OpenFem3DSelection>(null);
  const selection = controlledSelection === undefined ? internalSelection : controlledSelection;
  const setSelection = (next: OpenFem3DSelection) => {
    if (controlledSelection === undefined) setInternalSelection(next);
    onSelectionChange?.(next);
  };
  const [fitToken, setFitToken] = useState(0);
  const [drawError, setDrawError] = useState<string | null>(null);
  // Het actieve level voor tekenen; null = het level op peil 0, of peil 0 zelf.
  const [workLevelId, setWorkLevelId] = useState<string | null>(null);
  const levels = structuralGrid?.zAxes ?? [];
  const workLevel = openFem3DWorkLevel(levels, workLevelId);
  const workPlaneOptions = openFem3DWorkPlaneOptions(levels);
  const [internalVisibility, setInternalVisibility] = useState(readOpenFem3DVisibility);
  const [cameraState, setCameraState] = useState<OpenFem3DCameraState>(initialCamera ?? {
    position: [8, 8, 6], target: [0, 0, 0], up: [0, 0, 1],
  });
  const [cameraRequest, setCameraRequest] = useState<{ state: OpenFem3DCameraState; token: number } | undefined>(
    initialCamera ? { state: initialCamera, token: 1 } : undefined,
  );
  const visibility = visibilityProp ?? internalVisibility;
  const canvasVisibility = useMemo(
    () => showLoadCase ? visibility : { ...visibility, loads: false },
    [showLoadCase, visibility],
  );
  const lastDeleteToken = useRef(deleteToken);
  const setVisibility = (next: OpenFem3DVisibility) => {
    if (onVisibilityChange) onVisibilityChange(next);
    else setInternalVisibility(next);
  };

  useEffect(() => { saveOpenFem3DVisibility(visibility); }, [visibility]);
  // Na het passend beeld van de view (viewRequest) de exacte camera van de view.
  // Alleen een NIEUW verzoek: na opnieuw openen van de werkruimte geldt de
  // laatst bekende camera (initialCamera), niet een oud verzoek.
  const cameraVerzoekToken = useRef(cameraVerzoek?.token);
  useEffect(() => {
    if (!cameraVerzoek || cameraVerzoek.token === cameraVerzoekToken.current) return;
    cameraVerzoekToken.current = cameraVerzoek.token;
    setCameraRequest((previous) => ({ state: cameraVerzoek.state, token: (previous?.token ?? 0) + 1 }));
  }, [cameraVerzoek?.token]);
  useEffect(() => {
    if (!selection) return;
    const loadInActiveCase = (load: { caseId?: number }) =>
      showLoadCase && (activeLoadCaseId === undefined || openFem3DLoadCaseId(load) === activeLoadCaseId);
    if (selection.type === "multi") {
      const nodeIds = selection.nodeIds.filter((id) => model.nodes.some((node) => node.id === id));
      const beamIds = selection.beamIds.filter((id) => model.beams.some((beam) => beam.id === id));
      const plateIds = (selection.plateIds ?? []).filter((id) => (model.plates ?? []).some((plate) => plate.id === id));
      if (nodeIds.length !== selection.nodeIds.length || beamIds.length !== selection.beamIds.length || plateIds.length !== (selection.plateIds?.length ?? 0)) {
        const total = nodeIds.length + beamIds.length + plateIds.length;
        setSelection(total === 0 ? null
          : total === 1 ? nodeIds.length ? { type: "node", id: nodeIds[0] } : beamIds.length ? { type: "beam", id: beamIds[0] } : { type: "plate", id: plateIds[0] }
          : { type: "multi", nodeIds, beamIds, ...(plateIds.length ? { plateIds } : {}) });
      }
      return;
    }
    const exists = selection.type === "node" ? model.nodes.some((node) => node.id === selection.id)
      : selection.type === "beam" ? model.beams.some((beam) => beam.id === selection.id)
      : selection.type === "nodalLoad" ? (model.loads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load))
      : selection.type === "memberLoad" ? (model.memberLoads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load))
      : selection.type === "memberPointLoad" ? (model.memberPointLoads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load))
      : selection.type === "thermalLoad" ? (model.thermalLoads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load))
      : selection.type === "plate" ? (model.plates ?? []).some((plate) => plate.id === selection.id)
      : selection.type === "loadPanel" ? (model.loadPanels ?? []).some((panel) => panel.id === selection.id && loadInActiveCase(panel))
      : (model.surfaceLoads ?? []).some((load) => load.id === selection.id && loadInActiveCase(load));
    if (!exists) setSelection(null);
  }, [model.nodes, model.beams, model.plates, model.loads, model.memberLoads, model.memberPointLoads, model.thermalLoads, model.surfaceLoads, model.loadPanels, selection, showLoadCase, activeLoadCaseId]);

  // Verwijderen via de lintknop (deleteToken) of de Delete-toets: dezelfde
  // bewerking, één stap in de historie (Ctrl+Z zet alles terug).
  const deleteSelection = () => {
    if (!selection) return;
    onChange(removeOpenFem3DSelection(model, selection));
    setSelection(null);
  };
  const deleteSelectionRef = useRef(deleteSelection);
  deleteSelectionRef.current = deleteSelection;
  useEffect(() => {
    if (deleteToken === lastDeleteToken.current) return;
    lastDeleteToken.current = deleteToken;
    deleteSelection();
  }, [deleteToken]);

  // Het rekennet voor de weergave "Mesh" zonder resultaat: asynchroon (Triangle)
  // en met een korte vertraging, zodat slepen niet elke tussenstap meshed.
  const [displayMesh, setDisplayMesh] = useState<OpenFem3DPlateMesh | null>(null);
  const [meshMessage, setMeshMessage] = useState<string | null>(null);
  const needsDisplayMesh = visibility.mesh && visibility.plates && (model.plates ?? []).length > 0 && !result?.plateMesh;
  useEffect(() => {
    if (!needsDisplayMesh) { setMeshMessage(null); return; }
    let cancelled = false;
    setMeshMessage(t("openFem3dPlate.meshPending", { ns: "common" }));
    const timer = window.setTimeout(() => {
      const pending = openFem3DPlateMeshFor(model);
      if (!pending) return;
      pending.then((mesh) => {
        if (cancelled) return;
        setDisplayMesh(mesh);
        setMeshMessage(null);
      }, (error: unknown) => {
        if (cancelled) return;
        setDisplayMesh(null);
        setMeshMessage(t("openFem3dPlate.meshFailed", {
          ns: "common", message: error instanceof Error ? error.message : String(error),
        }));
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [needsDisplayMesh, model.plates, model.nodes, model.beams]);
  const contourRange = result && plateQuantity && visibility.plates
    ? openFem3DPlateQuantityRange(result, plateQuantity) : null;
  const platesLinear = result?.diagnostics.includes(OPEN_FEM_3D_PLATES_LINEAR_NOTICE) ?? false;
  const maxDisplacement = result ? openFem3DMaximumDisplacementM(model, result) : 0;
  const utilizations = useMemo(
    () => buildOpenFem3DUtilizations(checks, concreteChecks),
    [checks, concreteChecks],
  );
  // Dezelfde regel en toekenning als ThreeFrameCanvas (lib/profielKleur.ts):
  // de legenda staat er alleen als de staven ook echt naar profiel kleuren.
  const profielKleuren = useMemo(
    () => (canvasVisibility.beams && profielKleurenActief3d(canvasVisibility, utilizations.length)
      ? openFem3DProfielKleuring(model.beams) : null),
    [canvasVisibility, utilizations.length, model.beams],
  );
  // Dezelfde toetscommando's als het 2D-tekenvlak: M (verplaatsen), MV en CO
  // (kopiëren); zie lib/commandoReeks.ts. Niet in invoervelden.
  const toetsPrefixRef = useRef<Prefix>(null);
  const onToolChangeRef = useRef(onToolChange);
  onToolChangeRef.current = onToolChange;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Delete verwijdert de selectie, net als de lintknop Verwijderen. Niet
      // in invoervelden en niet onder een open dialoog.
      if (event.key === "Delete") {
        if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
        if (isInvoerVeld(event.target) || erIsEenDialoogOpen()) return;
        event.preventDefault();
        deleteSelectionRef.current();
        return;
      }
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;
      const doel = event.target as HTMLElement | null;
      if (doel && (doel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(doel.tagName))) return;
      const r = verwerkToets(toetsPrefixRef.current, event.key, Date.now());
      toetsPrefixRef.current = r.prefix;
      if (r.tool) { event.preventDefault(); onToolChangeRef.current?.(r.tool); return; }
      if (r.verbruikt) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const transformTool = (["move", "rotate", "copy", "mirror"] as const)
    .find((candidate) => candidate === tool);
  const transformSelection = selection && (
    selection.type === "node" || selection.type === "beam" || selection.type === "plate" || selection.type === "multi"
  ) ? selection : null;
  const applyTransform = (command: OpenFem3DTransformCommand) => {
    if (!transformSelection) return;
    const transformed = transformOpenFem3D(model, transformSelection, command);
    if (transformed.model !== model) onChange(transformed.model);
    setSelection(transformed.selection);
    onToolChange?.("select");
  };

  return (
    <div className="open-fem3d-editor">
      <div className="open-fem3d-stage">
        <ThreeFrameCanvas
          model={model}
          conditionModel={calculationModel}
          onChange={onChange}
          onDrawError={setDrawError}
          tool={tool}
          selection={selection}
          onSelect={setSelection}
          onOpenCheckForBeam={onOpenCheckForBeam}
          fitToken={fitToken + fitRequest}
          viewRequest={viewRequest}
          currentView={currentView}
          visibility={canvasVisibility}
          structuralGrid={structuralGrid}
          gridSpacingM={gridSpacingM}
          workPlaneZ={workLevel.zM}
          result={result}
          plateMesh={needsDisplayMesh ? displayMesh : null}
          plateQuantity={plateQuantity}
          utilizations={utilizations}
          activeLoadCaseId={activeLoadCaseId}
          cameraRequest={cameraRequest}
          onCameraChange={(state) => {
            setCameraState(state);
            onCameraStateChange?.(state);
          }}
          onCameraViewChange={onCameraViewChange}
          loadCaseTypes={loadCaseTypes}
          onToolChange={onToolChange}
          onPlaceNodeCondition={onPlaceNodeCondition}
          deformationDisplay={deformationDisplay}
        />
        <div className="open-fem3d-stage-header">
          <strong>{t("openFem3d.title")}</strong>
          <span>{t(tool.startsWith("support:") ? "openFem3d.supportPlacementHelp"
            : tool.startsWith("spring:") ? "openFem3d.springPlacementHelp"
              : DRAW_HELP_KEYS[tool] ?? "openFem3d.axisHelp", { defaultValue: t("openFem3d.axisHelp") })}</span>
          {/* Het werkvlak voor tekenen: een klik in leeg canvas landt op het
              actieve level (standaard peil 0). In voor- en zijaanzicht staat
              een horizontaal vlak op zijn kant; daar geldt het aanzichtvlak. */}
          <label className="open-fem3d-workplane" title={t("openFem3d.workPlane.title")}
            data-open-fem3d-work-plane-z={workLevel.zM} data-open-fem3d-work-plane-level={workLevel.levelId ?? ""}>
            <span>{t("openFem3d.workPlane.label")}</span>
            <select value={workLevel.levelId ?? ""} onChange={(event) => setWorkLevelId(event.target.value || null)}>
              {workPlaneOptions.map((option) => <option key={option.value || "peil-0"} value={option.value}>
                {option.level
                  ? t("openFem3d.levels.option", { name: openFem3DLevelName(option.level), height: toonMm(option.level.position) })
                  : t("openFem3d.workPlane.zero")}
              </option>)}
            </select>
            {!openFem3DWorkPlaneIsHorizontal(currentView) && <em>{t("openFem3d.workPlane.vertical")}</em>}
          </label>
          <button type="button" className="open-fem3d-views-button" onClick={onVisibilityOpen}>{t("openFem3d.viewsButton", { n: viewSets.length })}</button>
        </div>
        {drawError && <div className="open-fem3d-draw-error" role="alert">
          <span>{drawError}</span>
          <button type="button" aria-label={t("openFem3d.closeMessage")} onClick={() => setDrawError(null)}>×</button>
        </div>}
        <button className="open-fem3d-fit" onClick={() => setFitToken((n) => n + 1)} type="button">
          {t("openFem3d.fit")}
        </button>
        {transformTool && transformSelection && <OpenFem3DTransformPanel
          tool={transformTool}
          selectionLabel={transformSelection.type === "multi"
            ? t("openFem3d.multiSelection", {
              count: openFem3DSelectionCount(transformSelection), nodes: transformSelection.nodeIds.length,
              beams: transformSelection.beamIds.length, plates: transformSelection.plateIds?.length ?? 0,
            })
            : transformSelection.type === "node" ? t("tree.nodeLabel", { ns: "common", id: transformSelection.id })
              : transformSelection.type === "beam" ? t("tree.barLabel", { ns: "common", id: transformSelection.id })
                : t("tree.plateLabel", { ns: "common", id: transformSelection.id })}
          onApply={applyTransform}
          onCancel={() => onToolChange?.("select")}
        />}
        {visibility.utilization && utilizations.length > 0 && (
          <div className="open-fem3d-uc-legend" aria-label={t("openFem3d.utilizationLegend")}>
            <strong>{t("openFem3d.utilization")}</strong>
            <span><i data-uc="low" />≤ 0,50</span>
            <span><i data-uc="medium" />0,50–0,80</span>
            <span><i data-uc="high" />0,80–1,00</span>
            <span><i data-uc="fail" />&gt; 1,00</span>
            <span><i data-uc="not-applicable" />{t("openFem3d.notChecked")}</span>
          </div>
        )}
        {profielKleuren && (
          <ProfielKleurLegenda regels={profielKleuren.regels} variant="3d" className="open-fem3d-profiel-legenda" />
        )}
        {contourRange && plateQuantity && (
          <div className="open-fem3d-plate-legend" role="img"
            aria-label={t("openFem3dPlate.legend", { ns: "common" })} data-open-fem3d-plate-legend={plateQuantity}>
            <strong>
              {t(`openFem3dPlate.quantity.${plateQuantity}`, { ns: "common" })} ({openFem3DPlateQuantity(plateQuantity).unit})
            </strong>
            <span className="open-fem3d-plate-legend-bar" style={{ background: openFem3DContourGradientCss() }} />
            <span className="open-fem3d-plate-legend-values">
              <span>{formatOpenFem3DPlateValue(contourRange.min)}</span>
              <span>{formatOpenFem3DPlateValue(contourRange.max)}</span>
            </span>
            <small>{t("openFem3dPlate.signNote", { ns: "common" })}</small>
            {platesLinear && <small>{t("openFem3dPlate.linearNotice", { ns: "common" })}</small>}
          </div>
        )}
        {meshMessage && <div className="open-fem3d-plate-mesh-message" role="status">{meshMessage}</div>}
        {showLoadCase && (result?.inactiveMembers?.length ?? 0) > 0 && (
          <div className="open-fem3d-inactive-legend" data-open-fem3d-inactive-legend
            title={t("openFem3d.trekSchijf.legendHint")}>
            <i />{t("openFem3d.trekSchijf.legendInactive", { count: result?.inactiveMembers?.length ?? 0 })}
          </div>
        )}
        {model.nodes.length === 0 && <div className="open-fem3d-empty">{t("openFem3d.empty")}</div>}
        <div className="open-fem3d-stage-footer">
          <span>{t("openFem3d.nodeCount", { count: model.nodes.length })} · {t("openFem3d.beamCount", { count: model.beams.length })}</span>
          <span data-open-fem-3d-status={solveError ? "error" : solving ? "solving" : result?.forceBalance?.ok === false ? "warning" : result ? "solved" : "ready"}>
            {solveError ? solveError
              : solving ? t("openFem3d.solving")
              : result?.forceBalance?.ok === false ? `Evenwicht wijkt af: ${result.forceBalance.maxImbalanceKn.toFixed(3)} kN` +
                (Number.isFinite(result.forceBalance.maxMomentImbalanceKnm) ? ` / ${result.forceBalance.maxMomentImbalanceKnm.toFixed(3)} kNm` : "") +
                " · resultaat niet geverifieerd"
              : result ? t("openFem3d.solved", { engine: result.engine.name, value: (maxDisplacement * 1000).toPrecision(4) })
              : t("openFem3d.readyToCalculate")}
          </span>
        </div>
      </div>
      <OpenFem3DVisibilityDialog
        open={visibilityOpen}
        onClose={() => onVisibilityClose?.()}
        visibility={visibility}
        onChange={setVisibility}
        viewSets={viewSets}
        currentView={currentView}
        currentCamera={cameraState}
        currentCombinationId={currentCombinationId}
        currentLoadCaseId={activeLoadCaseId ?? 1}
        currentMode={!showLoadCase ? "model" : resultsActive ? "results" : "loadCase"}
        combinationOptions={combinationOptions}
        loadCaseOptions={loadCaseOptions}
        onViewSetsChange={onViewSetsChange}
        onApplyViewSet={(viewSet) => {
          setCameraRequest((previous) => ({ state: viewSet.camera, token: (previous?.token ?? 0) + 1 }));
          onApplyViewSet?.(viewSet);
        }}
      />
    </div>
  );
}
