import { Children, useState, type Dispatch, type SetStateAction } from "react";
import OpenFem3DViewsTab, { type OpenFem3DViewsTabProps } from "./OpenFem3DViewsTab";
import { useTranslation } from "react-i18next";
import ExplorerViewTab from "../fem/ExplorerViewTab";
import type { DisplayFlags } from "../fem/FemResultsOverlay";
import type { StructuralGrid } from "../fem/femTypes";
import type { LoadCombination } from "../fem/solver/combinations";
import { openFem3DSelectionContains, toggleOpenFem3DSelection, type OpenFem3DSelection, type OpenFem3DSingleSelection } from "./openFem3dSelection";
import { openFem3DSupportPresetOf, type OpenFem3DModel } from "./openFem3dModel";
import { openFem3DMemberLoadSummary } from "./OpenFem3DMemberLoads";
import { removeOpenFem3DDiaphragm } from "./openFem3dTrekSchijf";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import { openFem3DUlsUc, type OpenFem3DSteelChecks } from "./openFem3dSteelCheck";
import type { OpenFem3DConcreteChecks } from "./openFem3dConcreteCheck";
import type { OpenFem3DTimberChecks } from "./openFem3dTimberCheck";
import { OPEN_FEM_3D_RESULT_LAYERS, type OpenFem3DVisibility } from "./openFem3dVisibility";
import { isOpenFem3DPlateQuantity, openFem3DPlateQuantitiesFor, type OpenFem3DPlateQuantity } from "./openFem3dPlateResults";
import { OPEN_FEM_3D_PLATES_LINEAR_NOTICE } from "./openFem3dSolver";
import { openFem3DMaximumDisplacementM } from "./openFem3dDisplacement";
import { toonMm } from "../../lib/lengthInput";
import { noemerTekst } from "../../lib/scheefstandNorm";
import {
  DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY,
  OPEN_FEM_3D_DEFORMATION_SLIDER_STEPS,
  formatOpenFem3DDeformationScale,
  openFem3DAutoDeformationScale,
  openFem3DDeformationScale,
  openFem3DDeformationScaleFromSlider,
  openFem3DDeformationSliderFromScale,
  type OpenFem3DDeformationDisplay,
} from "./openFem3dDeformationDisplay";
import {
  DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS,
  OPEN_FEM_3D_DIAGRAM_LABEL_STANDS,
  normalizeOpenFem3DDiagramLabels,
  openFem3DFirstActiveForceLayer,
  type OpenFem3DDiagramLabels,
} from "./openFem3dDiagramLabels";
import "../fem/FemProjectTree.css";
import { openFem3DProfielTekst } from "./openFem3dVerloop";

interface Props {
  model: OpenFem3DModel;
  calculationModel?: OpenFem3DModel;
  selection: OpenFem3DSelection;
  setSelection: (selection: OpenFem3DSelection) => void;
  result: OpenFem3DSolveResult | null;
  checks?: OpenFem3DSteelChecks | null;
  concreteChecks?: OpenFem3DConcreteChecks | null;
  timberChecks?: OpenFem3DTimberChecks | null;
  checksRunning?: boolean;
  checksError?: string | null;
  /**
   * De toetsanalyse van de laatste rekengang (issue #199): de UGT-toets rekent
   * altijd P-Δ met scheefstand φ = 1/noemer. Leeg = nog geen toets.
   */
  toetsAnalyse?: { noemer: number } | null;
  activeTab?: "project" | "view" | "results";
  setActiveTab?: (tab: "project" | "view" | "results") => void;
  visibility: OpenFem3DVisibility;
  setVisibility: (visibility: OpenFem3DVisibility) => void;
  /** Vergroting van de vervormde vorm en "Origineel tonen" (weergavevoorkeur). */
  deformationDisplay?: OpenFem3DDeformationDisplay;
  setDeformationDisplay?: (display: OpenFem3DDeformationDisplay) => void;
  /** Getallen bij de snedekrachtlijnen: Waarden aan/uit en weinig … veel (weergavevoorkeur, issue #95). */
  diagramLabels?: OpenFem3DDiagramLabels;
  setDiagramLabels?: (labels: OpenFem3DDiagramLabels) => void;
  /** Grootheid van de plaatcontour; `null` = geen contour. */
  plateQuantity?: OpenFem3DPlateQuantity | null;
  setPlateQuantity?: (quantity: OpenFem3DPlateQuantity | null) => void;
  displayFlags: DisplayFlags;
  setDisplayFlags: Dispatch<SetStateAction<DisplayFlags>>;
  gridShow: boolean;
  setGridShow: (show: boolean) => void;
  structuralGrid: StructuralGrid;
  setStructuralGridEnabled: (enabled: boolean) => void;
  activeLoadCaseId?: number;
  /**
   * Er is gerekend, maar het actieve belastinggeval heeft geen eigen resultaat
   * (geen last). De resultatentab zegt dat en noemt wat er getoond wordt (#245).
   */
  activeCaseEmpty?: boolean;
  combinations?: readonly LoadCombination[];
  combinationResults?: ReadonlyMap<number, OpenFem3DSolveResult>;
  activeCombinationId?: number | null;
  setActiveCombinationId?: (id: number) => void;
  /** De tab Views (standaard- en eigen views); zonder deze prop geen vierde tab. */
  views?: OpenFem3DViewsTabProps;
  /** Modelwijziging vanuit de verkenner (bijvoorbeeld een schijf verwijderen), één stap ongedaan maken. */
  onChange?: (model: OpenFem3DModel) => void;
}

const GROTE_TAK_GRENS = 80;
const TAK_PAGINA = 80;

function Branch({ label, count, children, showNextLabel, defaultOpen, action }: {
  label: string;
  count: number;
  children: React.ReactNode;
  showNextLabel: (count: number) => string;
  /** Begint open of dicht; zonder: open tot GROTE_TAK_GRENS items. */
  defaultOpen?: boolean;
  /** Een knop rechts van de kop, bijvoorbeeld "Alle selecteren". */
  action?: { label: string; onClick: () => void };
}) {
  const [open, setOpen] = useState(defaultOpen ?? count <= GROTE_TAK_GRENS);
  const [limit, setLimit] = useState(TAK_PAGINA);
  const items = open ? Children.toArray(children) : [];
  return <div className="fem-tree-node">
    <div className="fem-tree-row-with-action">
      <button className="fem-tree-row" onClick={() => setOpen(!open)}>
        <span className={`fem-tree-chevron${open ? " open" : ""}`}><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 2l4 3-4 3z" /></svg></span>
        <span className="fem-tree-label">{label}</span><span className="fem-tree-count">{count}</span>
      </button>
      {action && count > 0 && <button type="button" className="fem-tree-row-action" onClick={action.onClick}>{action.label}</button>}
    </div>
    {open && <div className="fem-tree-children">
      {items.slice(0, limit)}
      {limit < items.length && <button
        type="button"
        className="fem-tree-leaf clickable"
        onClick={() => setLimit((current) => Math.min(items.length, current + TAK_PAGINA))}
      >
        <span className="fem-tree-leaf-label">{showNextLabel(Math.min(TAK_PAGINA, items.length - limit))}</span>
        <span className="fem-tree-leaf-value">{limit} / {items.length}</span>
      </button>}
    </div>}
  </div>;
}

function ItemBranch<T>({
  label, items, renderItem, showNextLabel,
}: {
  label: string;
  items: readonly T[];
  renderItem: (item: T) => React.ReactNode;
  showNextLabel: (count: number) => string;
}) {
  const [open, setOpen] = useState(items.length <= GROTE_TAK_GRENS);
  const [limit, setLimit] = useState(TAK_PAGINA);
  const visibleItems = open ? items.slice(0, limit) : [];
  return <div className="fem-tree-node">
    <button className="fem-tree-row" onClick={() => setOpen(!open)}>
      <span className={`fem-tree-chevron${open ? " open" : ""}`}><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 2l4 3-4 3z" /></svg></span>
      <span className="fem-tree-label">{label}</span><span className="fem-tree-count">{items.length}</span>
    </button>
    {open && <div className="fem-tree-children">
      {visibleItems.map(renderItem)}
      {limit < items.length && <button
        type="button"
        className="fem-tree-leaf clickable"
        onClick={() => setLimit((current) => Math.min(items.length, current + TAK_PAGINA))}
      >
        <span className="fem-tree-leaf-label">{showNextLabel(Math.min(TAK_PAGINA, items.length - limit))}</span>
        <span className="fem-tree-leaf-value">{limit} / {items.length}</span>
      </button>}
    </div>}
  </div>;
}

function Leaf({ label, value, active, onClick }: { label: string; value?: string; active?: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  return <button type="button" className={`fem-tree-leaf clickable${active ? " active" : ""}`} onClick={onClick}>
    <span className="fem-tree-leaf-label">{label}</span>{value && <span className="fem-tree-leaf-value">{value}</span>}
  </button>;
}

/**
 * Onder "Vervormde vorm": de vergroting (logaritmisch 1× – 1000×, of
 * automatisch) met de actuele factor, en of het onvervormde model erachter te
 * zien is. Dezelfde subregels als de schaalregelaars van de 2D-resultaten.
 */
function DeformationControls({ display, setDisplay, autoScale }: {
  display: OpenFem3DDeformationDisplay;
  setDisplay: (display: OpenFem3DDeformationDisplay) => void;
  autoScale: number | null;
}) {
  const { t } = useTranslation("common");
  const auto = display.scale === "auto";
  const current = autoScale === null && auto ? null : openFem3DDeformationScale(display, autoScale ?? 1);
  return <>
    <div className="fem-results-scale-row" title={t("openFem3dDeformation.scaleHint")} data-open-fem3d-deformation-scale>
      <label className="fem-results-subcheck" title={t("openFem3dDeformation.scaleHint")}>
        <input type="checkbox" checked={auto} data-open-fem3d-deformation-auto
          onChange={(event) => setDisplay({
            ...display,
            // Uit Automatisch: verder met de huidige factor, afgerond op een stand van de regelaar.
            scale: event.target.checked ? "auto"
              : openFem3DDeformationScaleFromSlider(openFem3DDeformationSliderFromScale(current ?? 1)),
          })} />
        <span>{t("openFem3dDeformation.auto")}</span>
      </label>
      <input type="range" className="fem-results-scale-slider" aria-label={t("openFem3dDeformation.scale")}
        min={0} max={OPEN_FEM_3D_DEFORMATION_SLIDER_STEPS} step={1}
        value={openFem3DDeformationSliderFromScale(current ?? 1)}
        onChange={(event) => setDisplay({ ...display, scale: openFem3DDeformationScaleFromSlider(Number(event.target.value)) })} />
      <span className="fem-results-scale-value" data-open-fem3d-deformation-factor>
        {current === null ? "—" : formatOpenFem3DDeformationScale(current)}
      </span>
    </div>
    <div className="fem-results-scale-row" title={t("openFem3dDeformation.showOriginalHint")}>
      <label className="fem-results-subcheck">
        <input type="checkbox" checked={display.showOriginal} data-open-fem3d-show-original
          onChange={(event) => setDisplay({ ...display, showOriginal: event.target.checked })} />
        <span>{t("openFem3dDeformation.showOriginal")}</span>
      </label>
    </div>
  </>;
}

/**
 * Onder de eerste aangevinkte snedekrachtlijn: Waarden aan/uit en een
 * regelaar van weinig tot veel (5 standen), één instelling voor alle zes
 * lijnen. Dezelfde subregel als de vergroting onder Vervormde vorm.
 */
function DiagramLabelControls({ labels, setLabels }: {
  labels: OpenFem3DDiagramLabels;
  setLabels: (labels: OpenFem3DDiagramLabels) => void;
}) {
  const { t } = useTranslation("common");
  const stands = OPEN_FEM_3D_DIAGRAM_LABEL_STANDS;
  return <div className="fem-results-scale-row" title={t("openFem3dDiagramLabels.densityHint")} data-open-fem3d-diagram-label-controls>
    <label className="fem-results-subcheck" title={t("openFem3dDiagramLabels.valuesHint")}>
      <input type="checkbox" checked={labels.show} aria-label={t("openFem3dDiagramLabels.valuesAria")}
        onChange={(event) => setLabels({ ...labels, show: event.target.checked })} />
      <span>{t("openFem3dDiagramLabels.values")}</span>
    </label>
    <span className="fem-results-scale-end" aria-hidden="true">{t("openFem3dDiagramLabels.few")}</span>
    <input type="range" className="fem-results-scale-slider" aria-label={t("openFem3dDiagramLabels.density")}
      min={OPEN_FEM_3D_DIAGRAM_LABEL_STANDS[0]} max={stands[stands.length - 1]} step={1}
      value={labels.stand} disabled={!labels.show}
      aria-valuetext={t("openFem3dDiagramLabels.densityValue", { n: labels.stand, max: stands[stands.length - 1] })}
      onChange={(event) => setLabels(normalizeOpenFem3DDiagramLabels({ ...labels, stand: Number(event.target.value) }))} />
    <span className="fem-results-scale-end" aria-hidden="true">{t("openFem3dDiagramLabels.many")}</span>
  </div>;
}

const RESULT_KEYS = OPEN_FEM_3D_RESULT_LAYERS;

export default function OpenFem3DExplorer(props: Props) {
  const { t } = useTranslation("common");
  const [internalTab, setInternalTab] = useState<"project" | "view" | "results">("project");
  const tab = props.activeTab ?? internalTab;
  const setTab = props.setActiveTab ?? setInternalTab;
  // De tab Views leeft hier: de app stuurt alleen Project, Weergave en
  // Resultaten. Views blijft open zolang de app-tab dezelfde is als bij het
  // openen; kiest de app zelf een andere tab (bijvoorbeeld na Berekenen), dan
  // sluit Views. Een view toepassen vanuit Views laat de app-tab staan.
  const [viewsBij, setViewsBij] = useState<string | null>(null);
  const kies = (next: "project" | "view" | "results") => { setViewsBij(null); setTab(next); };
  const toon = props.views && viewsBij === tab ? "views" : tab;
  const maxDisplacement = props.result ? openFem3DMaximumDisplacementM(props.model, props.result) : 0;
  const alphaCr = props.result?.buckling.status === "available" ? props.result.buckling.modes[0]?.loadFactor : undefined;
  // Een staaf met status n.v.t. is niet (volledig) getoetst; haar UC is geen
  // uitkomst en telt niet mee in het maximum (controle 2026-10, punt B7).
  const getoetsteStaal = props.checks?.results.filter((check) => check.status !== "NotApplicable") ?? [];
  const maxSteelUc = getoetsteStaal.length > 0
    ? getoetsteStaal.reduce((maximum, check) => Math.max(maximum, openFem3DUlsUc(check)), 0)
    : undefined;
  const maxConcreteUc = props.concreteChecks && props.concreteChecks.results.length > 0
    ? props.concreteChecks.results.reduce((maximum, check) => Math.max(maximum, check.uc_max), 0)
    : undefined;
  const maxTimberUc = props.timberChecks && props.timberChecks.results.length > 0
    ? props.timberChecks.results.reduce((maximum, result) => Math.max(maximum, ...result.checks
      .filter((check) => !check.id.startsWith("deflection_") && !check.id.startsWith("sls_"))
      .map((check) => check.kind.data.uc?.uc ?? 0)), 0)
    : undefined;
  const activeLoadCaseId = props.activeLoadCaseId ?? 1;
  const conditionModel = props.calculationModel ?? props.model;
  const nodalLoads = (conditionModel.loads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const memberLoads = (conditionModel.memberLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const memberPointLoads = (conditionModel.memberPointLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const thermalLoads = (conditionModel.thermalLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const surfaceLoads = (conditionModel.surfaceLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  // Native Rust-route (openFem3dNativeModel): volumes en hun lasten. Alleen
  // getoond als het model ze heeft; een gewoon 3D-model ziet geen extra tak.
  const volumes = props.model.volumes ?? [];
  const volumeBodyLoads = (props.model.volumeBodyLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const volumeFaceLoads = (props.model.volumeFaceLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const plateEdgeLoads = (props.model.plateEdgeLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const nativeLoadCount = volumeBodyLoads.length + volumeFaceLoads.length + plateEdgeLoads.length;
  const volumeById = new Map(volumes.map((volume) => [volume.id, volume]));
  // Een volume kiezen = zijn hoekknopen kiezen (de 3D-selectie kent geen volumesoort).
  const selectVolume = (volumeId: number) => {
    const volume = volumeById.get(volumeId);
    if (volume) props.setSelection({ type: "multi", nodeIds: [...volume.nodeIds], beamIds: [] });
  };
  const volumeSelected = (volumeId: number) => {
    const volume = volumeById.get(volumeId);
    return !!volume && props.selection?.type === "multi"
      && volume.nodeIds.every((nodeId) => openFem3DSelectionContains(props.selection, "node", nodeId));
  };
  // Belastingvlakken staan, net als de andere lasten, onder hun eigen geval.
  const loadPanels = (props.model.loadPanels ?? []).filter((panel) => (panel.caseId ?? 1) === activeLoadCaseId);
  const select = (event: React.MouseEvent<HTMLButtonElement>, item: OpenFem3DSingleSelection) =>
    props.setSelection(toggleOpenFem3DSelection(props.selection, item, event.shiftKey || event.ctrlKey || event.metaKey));
  // Het sub-blok Waarden staat onder de eerste aangevinkte snedekrachtlijn.
  const firstForceLayer = openFem3DFirstActiveForceLayer(props.visibility);

  return <div className="fem-project-tree" data-open-fem3d-explorer>
    <div className={`fem-tree-tabs${props.views ? " open-fem3d-vier-tabs" : ""}`}>
      <button className={`fem-tree-tab${toon === "project" ? " active" : ""}`} onClick={() => kies("project")}>{t("tree.projectTab")}</button>
      <button className={`fem-tree-tab${toon === "view" ? " active" : ""}`} onClick={() => kies("view")}>{t("tree.viewTab")}</button>
      <button className={`fem-tree-tab${toon === "results" ? " active" : ""}`} onClick={() => kies("results")}>{t("tree.resultsTab")}</button>
      {props.views && <button className={`fem-tree-tab${toon === "views" ? " active" : ""}`} onClick={() => setViewsBij(tab)}
        data-tab="views" title={t("openFem3dViews.tabHint")}>{t("openFem3dViews.tab")}</button>}
    </div>
    <div className="fem-tree-body">
      {toon === "views" && props.views && <OpenFem3DViewsTab {...props.views} />}
      {toon === "project" && <>
        <ItemBranch label={t("tree.nodes")} items={props.model.nodes}
          showNextLabel={(count) => t("tree.showNext", { count })} renderItem={(node) =>
          <Leaf key={node.id} label={t("tree.nodeLabel", { id: node.id })}
            value={`X:${toonMm(node.x, "m")} Y:${toonMm(node.y, "m")} Z:${toonMm(node.z, "m")}`}
            active={openFem3DSelectionContains(props.selection, "node", node.id)}
            onClick={(event) => select(event, { type: "node", id: node.id })} />
        } />
        <ItemBranch label={t("tree.elements")} items={props.model.beams}
          showNextLabel={(count) => t("tree.showNext", { count })} renderItem={(beam) =>
          <Leaf key={beam.id} label={t("tree.barLabel", { id: beam.id })}
            value={`${beam.startNodeId}-${beam.endNodeId} · ${beam.profileName ? openFem3DProfielTekst(beam, t) : "—"}`}
            active={openFem3DSelectionContains(props.selection, "beam", beam.id)}
            onClick={(event) => select(event, { type: "beam", id: beam.id })} />
        } />
        <Branch label={t("tree.plates")} count={(props.model.plates ?? []).length}
          showNextLabel={(count) => t("tree.showNext", { count })}>
          {(props.model.plates ?? []).map((plate) => {
            const outerArcs = plate.boundary?.filter((segment) => segment.kind === "arc").length ?? 0;
            const openingArcs = (plate.openings ?? []).reduce((count, opening) =>
              count + (opening.boundary?.filter((segment) => segment.kind === "arc").length ?? 0), 0);
            const openings = plate.openings?.length ?? 0;
            const outer = plate.boundary
              ? `${t("tree.edgeSegments", { n: plate.boundary.length })}${outerArcs ? ` ${t("tree.arcCount", { n: outerArcs })}` : ""}`
              : t("tree.corners", { count: plate.nodeIds.length });
            const holes = `${t("tree.openingCount", { count: openings })}${openingArcs ? ` ${t("tree.arcCount", { n: openingArcs })}` : ""}`;
            return <Leaf key={plate.id} label={t("tree.plateLabel", { id: plate.id })}
              value={`${outer} · ${holes} · ${toonMm(plate.thicknessM, "m")} mm`}
              active={openFem3DSelectionContains(props.selection, "plate", plate.id)}
              onClick={(event) => select(event, { type: "plate", id: plate.id })} />;
          })}
        </Branch>
        {volumes.length > 0 && <ItemBranch label={t("tree.volumes")} items={volumes}
          showNextLabel={(count) => t("tree.showNext", { count })} renderItem={(volume) =>
          <Leaf key={`volume-${volume.id}`}
            label={t("tree.volumeLabel", { kind: volume.kind === "tet4" ? "Tet4" : "Hex8", id: volume.id })}
            value={t("tree.volumeValue", { count: volume.nodeIds.length, e: volume.eMpa, nu: volume.poisson })}
            active={volumeSelected(volume.id)}
            onClick={() => selectVolume(volume.id)} />
        } />}
        <Branch label={t("tree.diaphragms")} count={(props.model.diaphragms ?? []).length}
          showNextLabel={(count) => t("tree.showNext", { count })}>
          {(props.model.diaphragms ?? []).map((diaphragm) => {
            const nodeIds = [...diaphragm.nodeIds].sort((a, b) => a - b);
            const z = props.model.nodes.find((node) => node.id === nodeIds[0])?.z ?? 0;
            const selected = props.selection?.type === "multi"
              && nodeIds.every((id) => props.selection?.type === "multi" && props.selection.nodeIds.includes(id));
            return <div key={`diaphragm-${diaphragm.id}`} className="open-fem3d-diaphragm-leaf" data-open-fem3d-diaphragm={diaphragm.id}>
              <Leaf label={diaphragm.name ? `${t("tree.diaphragmLabel", { id: diaphragm.id })} · ${diaphragm.name}` : t("tree.diaphragmLabel", { id: diaphragm.id })}
                value={t("tree.diaphragmValue", { count: nodeIds.length, z: toonMm(z, "m") })}
                active={selected}
                onClick={() => props.setSelection({ type: "multi", nodeIds, beamIds: [] })} />
              {props.onChange && <button type="button" className="open-fem3d-diaphragm-delete"
                aria-label={t("tree.deleteDiaphragm", { id: diaphragm.id })} title={t("tree.deleteDiaphragm", { id: diaphragm.id })}
                onClick={() => props.onChange?.(removeOpenFem3DDiaphragm(props.model, diaphragm.id))}>×</button>}
            </div>;
          })}
        </Branch>
        <Branch label={t("tree.supports")} count={(props.model.supports ?? []).length
          + (props.model.plates ?? []).reduce((count, plate) => count + (plate.edgeSupports?.length ?? 0), 0)}
          showNextLabel={(count) => t("tree.showNext", { count })}
          // Alle opleggingsknopen in één selectie, zodat een lintknop (bijv.
          // Scharnier) ze allemaal tegelijk wijzigt.
          action={(props.model.supports ?? []).length > 0 ? {
            label: t("tree.selectAll"),
            onClick: () => props.setSelection({
              type: "multi", nodeIds: (props.model.supports ?? []).map((support) => support.nodeId), beamIds: [],
            }),
          } : undefined}>
          {(props.model.supports ?? []).map((support) => <Leaf key={support.nodeId}
            label={t("tree.nodeLabel", { id: support.nodeId })}
            value={[
              t(`tree.support.${openFem3DSupportPresetOf(support)}`, openFem3DSupportPresetOf(support)),
              [support.ux && "Ux", support.uy && "Uy", support.uz && "Uz", support.rx && "Rx", support.ry && "Ry", support.rz && "Rz"].filter(Boolean).join(" "),
              ...([
                ["Kx", support.springs?.kxKnPerM], ["Ky", support.springs?.kyKnPerM], ["Kz", support.springs?.kzKnPerM],
                ["Krx", support.springs?.krxKnmPerRad], ["Kry", support.springs?.kryKnmPerRad], ["Krz", support.springs?.krzKnmPerRad],
              ] as const).flatMap(([label, stiffness]) => stiffness === undefined ? [] : [`${label} ${stiffness}`]),
              ...([
                ["Ux", support.prescribed?.uxM, 1000, "mm"], ["Uy", support.prescribed?.uyM, 1000, "mm"], ["Uz", support.prescribed?.uzM, 1000, "mm"],
                ["Rx", support.prescribed?.rxRad, 1000, "mrad"], ["Ry", support.prescribed?.ryRad, 1000, "mrad"], ["Rz", support.prescribed?.rzRad, 1000, "mrad"],
              ] as const).flatMap(([label, value, factor, unit]) => value === undefined ? [] : [`${label}=${value * factor} ${unit}`]),
            ].filter(Boolean).join(" · ")}
            active={openFem3DSelectionContains(props.selection, "node", support.nodeId)}
            onClick={(event) => select(event, { type: "node", id: support.nodeId })} />)}
          {/* Randopleggingen van platen: een klik selecteert de plaat. */}
          {(props.model.plates ?? []).flatMap((plate) => (plate.edgeSupports ?? []).map((support) => <Leaf
            key={`plate-${plate.id}-edge-${support.edge}`}
            label={t("tree.plateEdgeLabel", { id: plate.id, edge: support.edge + 1 })}
            value={[
              t(`tree.support.${openFem3DSupportPresetOf(support)}`, openFem3DSupportPresetOf(support)),
              [support.ux && "Ux", support.uy && "Uy", support.uz && "Uz", support.rx && "Rx", support.ry && "Ry", support.rz && "Rz"].filter(Boolean).join(" "),
            ].join(" · ")}
            active={openFem3DSelectionContains(props.selection, "plate", plate.id)}
            onClick={(event) => select(event, { type: "plate", id: plate.id })} />))}
        </Branch>
        <Branch label={t("tree.loads")} count={nodalLoads.length + memberLoads.length + memberPointLoads.length + thermalLoads.length + surfaceLoads.length + nativeLoadCount}
          showNextLabel={(count) => t("tree.showNext", { count })}>
          {nodalLoads.map((load) => <Leaf key={load.id} label={`#${load.id} · ${t("tree.nodeLabel", { id: load.nodeId })}`}
            value={[load.fx && `Fx ${load.fx}`, load.fy && `Fy ${load.fy}`, load.fz && `Fz ${load.fz}`, load.mx && `Mx ${load.mx}`, load.my && `My ${load.my}`, load.mz && `Mz ${load.mz}`].filter(Boolean).join(" · ")}
            active={openFem3DSelectionContains(props.selection, "nodalLoad", load.id)}
            onClick={(event) => select(event, { type: "nodalLoad", id: load.id })} />)}
          {memberLoads.map((load) => <Leaf key={`member-${load.id}`}
            label={`#${load.id} · ${t("tree.barLabel", { id: load.beamId })}`}
            value={openFem3DMemberLoadSummary(load, t("openFem3d.memberLoads.perProjectionShort", { ns: "ribbon" }))}
            active={openFem3DSelectionContains(props.selection, "memberLoad", load.id)}
            onClick={(event) => select(event, { type: "memberLoad", id: load.id })} />)}
          {memberPointLoads.map((load) => <Leaf key={`member-point-${load.id}`}
            label={`P#${load.id} · ${t("tree.barLabel", { id: load.beamId })}`}
            value={[load.py && `Py ${load.py}`, load.pz && `Pz ${load.pz}`, `x ${toonMm(load.positionM, "m")} mm`].filter(Boolean).join(" · ")}
            active={openFem3DSelectionContains(props.selection, "memberPointLoad", load.id)}
            onClick={(event) => select(event, { type: "memberPointLoad", id: load.id })} />)}
          {thermalLoads.map((load) => <Leaf key={`thermal-${load.id}`}
            label={`ΔT#${load.id} · ${t("tree.barLabel", { id: load.beamId })}`}
            value={`uniform ${load.deltaTUniformK} K · y ${load.deltaTGradientYK} K · z ${load.deltaTGradientZK} K`}
            active={openFem3DSelectionContains(props.selection, "thermalLoad", load.id)}
            onClick={(event) => select(event, { type: "thermalLoad", id: load.id })} />)}
          {surfaceLoads.map((load) => <Leaf key={`surface-${load.id}`}
            label={`q#${load.id} · ${t("tree.plateLabel", { id: load.plateId })}`}
            value={`qx ${load.qx} · qy ${load.qy} · qz ${load.qz} kN/m²`}
            active={openFem3DSelectionContains(props.selection, "surfaceLoad", load.id)}
            onClick={(event) => select(event, { type: "surfaceLoad", id: load.id })} />)}
          {volumeBodyLoads.map((load) => <Leaf key={`volume-body-${load.id}`}
            label={t("tree.volumeBodyLoadLabel", { id: load.id, volumeId: load.volumeId })}
            value={`${load.forceKnPerM3.join(" · ")} kN/m³`}
            active={volumeSelected(load.volumeId)}
            onClick={() => selectVolume(load.volumeId)} />)}
          {volumeFaceLoads.map((load) => <Leaf key={`volume-face-${load.id}`}
            label={t("tree.volumeFaceLoadLabel", { id: load.id, volumeId: load.volumeId, face: load.faceIndex + 1 })}
            value={`${load.tractionKnPerM2.join(" · ")} kN/m²`}
            active={volumeSelected(load.volumeId)}
            onClick={() => selectVolume(load.volumeId)} />)}
          {plateEdgeLoads.map((load) => <Leaf key={`plate-edge-${load.id}`}
            label={t("tree.plateEdgeLoadLabel", { id: load.id, plateId: load.plateId, edge: load.edgeIndex + 1 })}
            value={`${load.startKnPerM} → ${load.endKnPerM} kN/m`}
            active={openFem3DSelectionContains(props.selection, "plate", load.plateId)}
            onClick={(event) => select(event, { type: "plate", id: load.plateId })} />)}
        </Branch>
        <Branch label={t("tree.loadPanels")} count={loadPanels.length}
          showNextLabel={(count) => t("tree.showNext", { count })}>
          {loadPanels.map((panel) => <Leaf key={`panel-${panel.id}`}
            label={t("tree.loadPanelLabel", { id: panel.id })}
            value={`q ${panel.q} kN/m² · ${t(panel.direction === "gravity" ? "tree.loadPanelGravity"
              : panel.direction === "normal" ? "tree.loadPanelNormal" : "tree.loadPanelVerticalSurface")}`
              + ` · ${t(panel.distribution === "oneWay" ? "tree.loadPanelOneWay" : "tree.loadPanelTwoWay")}`}
            active={openFem3DSelectionContains(props.selection, "loadPanel", panel.id)}
            onClick={(event) => select(event, { type: "loadPanel", id: panel.id })} />)}
        </Branch>
        <Branch label={t("tree.envelopePanels")} count={(props.model.envelopePanels ?? []).length}
          showNextLabel={(count) => t("tree.showNext", { count })}>
          {(props.model.envelopePanels ?? []).map((panel) => <Leaf key={`envelope-${panel.id}`}
            label={panel.name || t("tree.envelopePanelLabel", { id: panel.id })}
            value={t(panel.type === "facade" ? "tree.envelopeFacade" : "tree.envelopeRoof")}
            active={openFem3DSelectionContains(props.selection, "envelopePanel", panel.id)}
            onClick={(event) => select(event, { type: "envelopePanel", id: panel.id })} />)}
        </Branch>
      </>}
      {toon === "view" && <ExplorerViewTab
        displayFlags={props.displayFlags} setDisplayFlags={props.setDisplayFlags}
        gridShow={props.gridShow} setGridShow={props.setGridShow}
        stramienAan={props.structuralGrid.enabled} setStramienAan={props.setStructuralGridEnabled}
        openFem3dVisibility={props.visibility} setOpenFem3DVisibility={props.setVisibility} workspace="3d"
      />}
      {toon === "results" && <div className="fem-results-tab" data-open-fem3d-results-tab>
        <div className="fem-results-section-title">{t("tree.resultsTab")}</div>
        {/* De analyse van de RESULTATEN, en daaronder die van de toetskrachten
            (issue #199): altijd tweede orde met scheefstand. In de taal van de
            interface; hier stond vaste Nederlandse tekst. */}
        {props.result ? <div className="fem-results-hint">
          {t(props.result.analysis === "p-delta" ? "tree.resultsSecondOrder" : "tree.resultsFirstOrder")} · Δmax {(maxDisplacement * 1000).toFixed(3)} mm · αcr {alphaCr?.toFixed(2) ?? "—"}
          {maxSteelUc !== undefined && <> · {t("tree.ucSteel", { uc: maxSteelUc.toFixed(2) })}</>}
          {maxConcreteUc !== undefined && <> · {t("tree.ucConcrete", { uc: maxConcreteUc.toFixed(2) })}</>}
          {maxTimberUc !== undefined && <> · {t("tree.ucTimber", { uc: maxTimberUc.toFixed(2) })}</>}
          {props.checksRunning && <> · {t("tree.checksRunning")}</>}
          {props.toetsAnalyse && <><br />{t("tree.checkForces", { noemer: noemerTekst(props.toetsAnalyse.noemer) })}</>}
          {props.checksError && <><br />{t("tree.checksError", { error: props.checksError })}</>}
          {props.result.diagnostics.includes(OPEN_FEM_3D_PLATES_LINEAR_NOTICE) && <><br />{t("openFem3dPlate.linearNotice")}</>}
          {props.result.nativeVolume3D && <><br /><span data-open-fem3d-native-volume-result>{t("tree.nativeVolumeResult", {
            count: props.result.nativeVolume3D.elements.length,
            sigma: props.result.nativeVolume3D.elements.reduce((maximum, element) => Math.max(maximum, element.vonMisesMpa), 0).toFixed(3),
            membranes: props.result.nativeVolume3D.membranes?.length ?? 0,
          })}</span></>}
        </div> : <div className="fem-results-hint">{t("tree.clickCalculateBefore")} <strong>{t("tree.calculate")}</strong>.</div>}
        {props.activeCaseEmpty && <div className="fem-results-hint" data-open-fem3d-active-case-empty>
          {t("tree.activeCaseEmpty3d", {
            getoond: props.combinations?.find((combination) => combination.id === props.activeCombinationId)?.name
              ?? t("tree.activeCaseEmpty3dNothing"),
          })}
        </div>}
        {openFem3DPlateQuantitiesFor(props.result).length > 0 && props.setPlateQuantity && <label className="fem-results-scale-row" data-open-fem3d-plate-quantity>
          <span>{t("openFem3dPlate.result")}</span>
          <select className="fem-prop-input" style={{ flex: 1, minWidth: 0 }}
            // Een gekozen grootheid die deze uitkomst niet heeft (Gronddruk zonder platen op bedding): Geen.
            value={props.plateQuantity && openFem3DPlateQuantitiesFor(props.result).some((quantity) => quantity.key === props.plateQuantity)
              ? props.plateQuantity : "none"}
            onChange={(event) => props.setPlateQuantity?.(isOpenFem3DPlateQuantity(event.target.value) ? event.target.value : null)}>
            <option value="none">{t("openFem3dPlate.none")}</option>
            {/* Gronddruk en Zakking (#107) alleen als er platen op bedding zijn. */}
            {openFem3DPlateQuantitiesFor(props.result).map((quantity) => <option key={quantity.key} value={quantity.key}>
              {t(`openFem3dPlate.quantity.${quantity.key}`)} ({quantity.unit})
            </option>)}
          </select>
        </label>}
        {(props.combinations?.length ?? 0) > 0 && (props.combinationResults?.size ?? 0) > 0 && <Branch
          label={t("tree.combinations")}
          count={props.combinationResults?.size ?? 0}
          defaultOpen={false}
          showNextLabel={(count) => t("tree.showNext", { count })}
        >
          {props.combinations?.filter((combination) => props.combinationResults?.has(combination.id)).map((combination) => {
            const result = props.combinationResults?.get(combination.id);
            const displacement = result ? openFem3DMaximumDisplacementM(props.model, result) : 0;
            return <Leaf
              key={combination.id}
              label={combination.name}
              value={`${combination.type === "uls" ? "UGT" : "BGT"} · Δ ${(displacement * 1000).toFixed(2)} mm`}
              active={props.activeCombinationId === combination.id}
              onClick={() => props.setActiveCombinationId?.(combination.id)}
            />;
          })}
        </Branch>}
        <div className="fem-results-toggle-list">
          {RESULT_KEYS.map((key) => <div key={key} className="fem-results-row" data-open-fem3d-result-layer={key}>
            <button type="button"
              className={`fem-results-toggle${props.visibility[key] ? " active" : ""}`}
              onClick={() => props.setVisibility({ ...props.visibility, [key]: !props.visibility[key] })}>
              <span className="fem-results-toggle-swatch" style={{ background: key === "deformation" ? "#dc2626" : key === "reactions" ? "#16a34a" : key === "utilization" ? "linear-gradient(90deg,#16a34a 0 25%,#84cc16 25% 50%,#f59e0b 50% 75%,#dc2626 75%)" : key === "groundPressure" ? "#8b5e34" : "#d97706" }} />
              <span className="fem-results-toggle-label">{t(`openFem3dVisibility.${key}`)}</span>
              <span className={`fem-switch${props.visibility[key] ? " on" : ""}`}><span className="fem-switch-dot" /></span>
            </button>
            {key === "deformation" && props.visibility.deformation && props.setDeformationDisplay
              && <DeformationControls display={props.deformationDisplay ?? DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY}
                setDisplay={props.setDeformationDisplay}
                autoScale={props.result ? openFem3DAutoDeformationScale(props.model, props.result) : null} />}
            {key === firstForceLayer && props.setDiagramLabels
              && <DiagramLabelControls labels={props.diagramLabels ?? DEFAULT_OPEN_FEM_3D_DIAGRAM_LABELS}
                setLabels={props.setDiagramLabels} />}
          </div>)}
        </div>
      </div>}
    </div>
  </div>;
}
