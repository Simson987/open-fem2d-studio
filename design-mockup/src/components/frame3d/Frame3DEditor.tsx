import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ThreeFrameCanvas from "./ThreeFrameCanvas";
import Frame3DVisibilityDialog from "./Frame3DVisibilityDialog";
import { readFrame3DVisibility, saveFrame3DVisibility, type Frame3DVisibility } from "./frame3dVisibility";
import type { Frame3DTool, Frame3DView } from "./frame3dCommands";
import {
  removeFrame3DBeam,
  removeFrame3DMemberLoad,
  removeFrame3DMemberPointLoad,
  removeFrame3DNodalLoad,
  removeFrame3DNode,
  removeFrame3DPlate,
  removeFrame3DSurfaceLoad,
  removeFrame3DThermalLoad,
  type Frame3DModel,
} from "./frame3dModel";
import type { StructuralGrid } from "../fem/femTypes";
import type { Frame3DSolveResult } from "./frame3dSolver";
import { frame3DMaximumDisplacementM } from "./frame3dDisplacement";
import type { Frame3DSteelChecks } from "./frame3dSteelCheck";
import type { Frame3DConcreteChecks } from "./frame3dConcreteCheck";
import { buildFrame3DUtilizations } from "./frame3dUtilization";
import Frame3DTransformPanel from "./Frame3DTransformPanel";
import { transformFrame3D, type Frame3DTransformCommand } from "./frame3dTransform";
import { frame3DSelectionCount, type Frame3DSelection } from "./frame3dSelection";
import type { Frame3DCameraState, Frame3DViewSet } from "./frame3dViewSets";
import type { Frame3DEditMeta } from "./frame3dHistory";
import "./Frame3DEditor.css";

interface Props {
  model: Frame3DModel;
  calculationModel?: Frame3DModel;
  onChange: (model: Frame3DModel, meta?: Frame3DEditMeta) => void;
  visibilityOpen?: boolean;
  onVisibilityClose?: () => void;
  tool?: Frame3DTool;
  onToolChange?: (tool: Frame3DTool) => void;
  deleteToken?: number;
  fitRequest?: number;
  viewRequest?: { kind: Frame3DView; token: number };
  selection?: Frame3DSelection;
  onSelectionChange?: (selection: Frame3DSelection) => void;
  visibility?: Frame3DVisibility;
  onVisibilityChange?: (visibility: Frame3DVisibility) => void;
  showLoadCase?: boolean;
  structuralGrid?: StructuralGrid;
  gridSpacingM?: number;
  result?: Frame3DSolveResult | null;
  checks?: Frame3DSteelChecks | null;
  concreteChecks?: Frame3DConcreteChecks | null;
  solving?: boolean;
  solveError?: string | null;
  activeLoadCaseId?: number;
  viewSets?: Frame3DViewSet[];
  currentView?: Frame3DView;
  currentCombinationId?: number | null;
  combinationOptions?: { id: number; name: string }[];
  onViewSetsChange?: (viewSets: Frame3DViewSet[]) => void;
  onApplyViewSet?: (viewSet: Frame3DViewSet) => void;
}

/** Canvas only: 3D uses the shared ribbon, Explorer and Properties panels. */
export default function Frame3DEditor({
  model, calculationModel, onChange, visibilityOpen = false, onVisibilityClose,
  tool = "select", onToolChange, deleteToken = 0, fitRequest = 0, viewRequest,
  selection: controlledSelection, onSelectionChange,
  visibility: visibilityProp, onVisibilityChange, showLoadCase = true, structuralGrid, gridSpacingM,
  result = null, checks = null, concreteChecks = null,
  solving = false, solveError = null, activeLoadCaseId,
  viewSets = [], currentView = "iso", currentCombinationId = null, combinationOptions = [],
  onViewSetsChange, onApplyViewSet,
}: Props) {
  const { t } = useTranslation("ribbon");
  const [internalSelection, setInternalSelection] = useState<Frame3DSelection>(null);
  const selection = controlledSelection === undefined ? internalSelection : controlledSelection;
  const setSelection = (next: Frame3DSelection) => {
    if (controlledSelection === undefined) setInternalSelection(next);
    onSelectionChange?.(next);
  };
  const [fitToken, setFitToken] = useState(0);
  const [internalVisibility, setInternalVisibility] = useState(readFrame3DVisibility);
  const [cameraState, setCameraState] = useState<Frame3DCameraState>({
    position: [8, 8, 6], target: [0, 0, 0], up: [0, 0, 1],
  });
  const [cameraRequest, setCameraRequest] = useState<{ state: Frame3DCameraState; token: number }>();
  const visibility = visibilityProp ?? internalVisibility;
  const canvasVisibility = useMemo(
    () => showLoadCase ? visibility : { ...visibility, loads: false },
    [showLoadCase, visibility],
  );
  const lastDeleteToken = useRef(deleteToken);
  const setVisibility = (next: Frame3DVisibility) => {
    if (onVisibilityChange) onVisibilityChange(next);
    else setInternalVisibility(next);
  };

  useEffect(() => { saveFrame3DVisibility(visibility); }, [visibility]);
  useEffect(() => {
    if (!selection) return;
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
      : selection.type === "nodalLoad" ? (model.loads ?? []).some((load) => load.id === selection.id)
      : selection.type === "memberLoad" ? (model.memberLoads ?? []).some((load) => load.id === selection.id)
      : selection.type === "memberPointLoad" ? (model.memberPointLoads ?? []).some((load) => load.id === selection.id)
      : selection.type === "thermalLoad" ? (model.thermalLoads ?? []).some((load) => load.id === selection.id)
      : selection.type === "plate" ? (model.plates ?? []).some((plate) => plate.id === selection.id)
      : (model.surfaceLoads ?? []).some((load) => load.id === selection.id);
    if (!exists) setSelection(null);
  }, [model.nodes, model.beams, model.plates, model.loads, model.memberLoads, model.memberPointLoads, model.thermalLoads, model.surfaceLoads, selection]);

  useEffect(() => {
    if (deleteToken === lastDeleteToken.current) return;
    lastDeleteToken.current = deleteToken;
    if (!selection) return;
    let next = model;
    if (selection.type === "multi") {
      for (const beamId of selection.beamIds) next = removeFrame3DBeam(next, beamId);
      for (const plateId of selection.plateIds ?? []) next = removeFrame3DPlate(next, plateId);
      for (const nodeId of selection.nodeIds) next = removeFrame3DNode(next, nodeId);
    } else {
      next = selection.type === "beam" ? removeFrame3DBeam(next, selection.id)
        : selection.type === "node" ? removeFrame3DNode(next, selection.id)
        : selection.type === "nodalLoad" ? removeFrame3DNodalLoad(next, selection.id)
        : selection.type === "memberLoad" ? removeFrame3DMemberLoad(next, selection.id)
        : selection.type === "memberPointLoad" ? removeFrame3DMemberPointLoad(next, selection.id)
        : selection.type === "thermalLoad" ? removeFrame3DThermalLoad(next, selection.id)
        : selection.type === "plate" ? removeFrame3DPlate(next, selection.id)
        : removeFrame3DSurfaceLoad(next, selection.id);
    }
    onChange(next);
    setSelection(null);
  }, [deleteToken]);

  const maxDisplacement = result ? frame3DMaximumDisplacementM(model, result) : 0;
  const utilizations = useMemo(
    () => buildFrame3DUtilizations(checks, concreteChecks),
    [checks, concreteChecks],
  );
  const transformTool = (["move", "rotate", "copy", "mirror"] as const)
    .find((candidate) => candidate === tool);
  const transformSelection = selection && (
    selection.type === "node" || selection.type === "beam" || selection.type === "plate" || selection.type === "multi"
  ) ? selection : null;
  const applyTransform = (command: Frame3DTransformCommand) => {
    if (!transformSelection) return;
    const transformed = transformFrame3D(model, transformSelection, command);
    if (transformed.model !== model) onChange(transformed.model);
    setSelection(transformed.selection);
    onToolChange?.("select");
  };

  return (
    <div className="frame3d-editor">
      <div className="frame3d-stage">
        <ThreeFrameCanvas
          model={model}
          conditionModel={calculationModel}
          onChange={onChange}
          tool={tool}
          selection={selection}
          onSelect={setSelection}
          fitToken={fitToken + fitRequest}
          viewRequest={viewRequest}
          currentView={currentView}
          visibility={canvasVisibility}
          structuralGrid={structuralGrid}
          gridSpacingM={gridSpacingM}
          result={result}
          utilizations={utilizations}
          activeLoadCaseId={activeLoadCaseId}
          cameraRequest={cameraRequest}
          onCameraChange={setCameraState}
        />
        <div className="frame3d-stage-header">
          <strong>{t("frame3d.title")}</strong>
          <span>{t("frame3d.axisHelp")}</span>
        </div>
        <button className="frame3d-fit" onClick={() => setFitToken((n) => n + 1)} type="button">
          {t("frame3d.fit")}
        </button>
        {transformTool && transformSelection && <Frame3DTransformPanel
          tool={transformTool}
          selectionLabel={transformSelection.type === "multi"
            ? `${frame3DSelectionCount(transformSelection)} elementen (${transformSelection.nodeIds.length} knopen, ${transformSelection.beamIds.length} staven, ${transformSelection.plateIds?.length ?? 0} platen)`
            : transformSelection.type === "node" ? `Knoop ${transformSelection.id}`
              : transformSelection.type === "beam" ? `Staaf ${transformSelection.id}` : `Plaat ${transformSelection.id}`}
          onApply={applyTransform}
          onCancel={() => onToolChange?.("select")}
        />}
        {visibility.utilization && utilizations.length > 0 && (
          <div className="frame3d-uc-legend" aria-label={t("frame3d.utilizationLegend")}>
            <strong>{t("frame3d.utilization")}</strong>
            <span><i data-uc="low" />≤ 0,50</span>
            <span><i data-uc="medium" />0,50–0,80</span>
            <span><i data-uc="high" />0,80–1,00</span>
            <span><i data-uc="fail" />&gt; 1,00</span>
            <span><i data-uc="not-applicable" />{t("frame3d.notChecked")}</span>
          </div>
        )}
        {model.nodes.length === 0 && <div className="frame3d-empty">{t("frame3d.empty")}</div>}
        <div className="frame3d-stage-footer">
          <span>{t("frame3d.nodeCount", { count: model.nodes.length })} · {t("frame3d.beamCount", { count: model.beams.length })}</span>
          <span data-frame3d-solver-status={solveError ? "error" : solving ? "solving" : result?.forceBalance?.ok === false ? "warning" : result ? "solved" : "ready"}>
            {solveError ? solveError
              : solving ? t("frame3d.solving")
              : result?.forceBalance?.ok === false ? `Evenwicht wijkt af: ${result.forceBalance.maxImbalanceKn.toFixed(3)} kN` +
                (Number.isFinite(result.forceBalance.maxMomentImbalanceKnm) ? ` / ${result.forceBalance.maxMomentImbalanceKnm.toFixed(3)} kNm` : "") +
                " · resultaat niet geverifieerd"
              : result ? t("frame3d.solved", { engine: result.engine.name, value: (maxDisplacement * 1000).toPrecision(4) })
              : t("frame3d.readyToCalculate")}
          </span>
        </div>
      </div>
      <Frame3DVisibilityDialog
        open={visibilityOpen}
        onClose={() => onVisibilityClose?.()}
        visibility={visibility}
        onChange={setVisibility}
        viewSets={viewSets}
        currentView={currentView}
        currentCamera={cameraState}
        currentCombinationId={currentCombinationId}
        combinationOptions={combinationOptions}
        onViewSetsChange={onViewSetsChange}
        onApplyViewSet={(viewSet) => {
          setCameraRequest((previous) => ({ state: viewSet.camera, token: (previous?.token ?? 0) + 1 }));
          onApplyViewSet?.(viewSet);
        }}
      />
    </div>
  );
}
