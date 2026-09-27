import { Children, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import ExplorerViewTab from "../fem/ExplorerViewTab";
import type { DisplayFlags } from "../fem/FemResultsOverlay";
import type { StructuralGrid } from "../fem/femTypes";
import type { LoadCombination } from "../fem/solver/combinations";
import { frame3DSelectionContains, toggleFrame3DSelection, type Frame3DSelection, type Frame3DSingleSelection } from "./frame3dSelection";
import { frame3DSupportPresetOf, type Frame3DModel } from "./frame3dModel";
import type { Frame3DSolveResult } from "./frame3dSolver";
import { frame3DUlsUc, type Frame3DSteelChecks } from "./frame3dSteelCheck";
import type { Frame3DConcreteChecks } from "./frame3dConcreteCheck";
import type { Frame3DVisibility } from "./frame3dVisibility";
import { frame3DMaximumDisplacementM } from "./frame3dDisplacement";
import "../fem/FemProjectTree.css";

interface Props {
  model: Frame3DModel;
  calculationModel?: Frame3DModel;
  selection: Frame3DSelection;
  setSelection: (selection: Frame3DSelection) => void;
  result: Frame3DSolveResult | null;
  checks?: Frame3DSteelChecks | null;
  concreteChecks?: Frame3DConcreteChecks | null;
  checksRunning?: boolean;
  checksError?: string | null;
  activeTab?: "project" | "view" | "results";
  setActiveTab?: (tab: "project" | "view" | "results") => void;
  visibility: Frame3DVisibility;
  setVisibility: (visibility: Frame3DVisibility) => void;
  displayFlags: DisplayFlags;
  setDisplayFlags: Dispatch<SetStateAction<DisplayFlags>>;
  gridShow: boolean;
  setGridShow: (show: boolean) => void;
  structuralGrid: StructuralGrid;
  setStructuralGridEnabled: (enabled: boolean) => void;
  activeLoadCaseId?: number;
  combinations?: readonly LoadCombination[];
  combinationResults?: ReadonlyMap<number, Frame3DSolveResult>;
  activeCombinationId?: number | null;
  setActiveCombinationId?: (id: number) => void;
}

const GROTE_TAK_GRENS = 80;
const TAK_PAGINA = 80;

function Branch({ label, count, children, showNextLabel }: {
  label: string;
  count: number;
  children: React.ReactNode;
  showNextLabel: (count: number) => string;
}) {
  const [open, setOpen] = useState(count <= GROTE_TAK_GRENS);
  const [limit, setLimit] = useState(TAK_PAGINA);
  const items = open ? Children.toArray(children) : [];
  return <div className="fem-tree-node">
    <button className="fem-tree-row" onClick={() => setOpen(!open)}>
      <span className={`fem-tree-chevron${open ? " open" : ""}`}><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 2l4 3-4 3z" /></svg></span>
      <span className="fem-tree-label">{label}</span><span className="fem-tree-count">{count}</span>
    </button>
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

const RESULT_KEYS: (keyof Frame3DVisibility)[] = [
  "deformation", "reactions", "utilization", "axialForce", "shearY", "shearZ", "torsion", "momentY", "momentZ",
];

export default function Frame3DExplorer(props: Props) {
  const { t } = useTranslation("common");
  const [internalTab, setInternalTab] = useState<"project" | "view" | "results">("project");
  const tab = props.activeTab ?? internalTab;
  const setTab = props.setActiveTab ?? setInternalTab;
  const maxDisplacement = props.result ? frame3DMaximumDisplacementM(props.model, props.result) : 0;
  const alphaCr = props.result?.buckling.status === "available" ? props.result.buckling.modes[0]?.loadFactor : undefined;
  const maxSteelUc = props.checks && props.checks.results.length > 0
    ? props.checks.results.reduce((maximum, check) => Math.max(maximum, frame3DUlsUc(check)), 0)
    : undefined;
  const maxConcreteUc = props.concreteChecks && props.concreteChecks.results.length > 0
    ? props.concreteChecks.results.reduce((maximum, check) => Math.max(maximum, check.uc_max), 0)
    : undefined;
  const activeLoadCaseId = props.activeLoadCaseId ?? 1;
  const conditionModel = props.calculationModel ?? props.model;
  const nodalLoads = (conditionModel.loads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const memberLoads = (conditionModel.memberLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const memberPointLoads = (conditionModel.memberPointLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const thermalLoads = (conditionModel.thermalLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const surfaceLoads = (conditionModel.surfaceLoads ?? []).filter((load) => (load.caseId ?? 1) === activeLoadCaseId);
  const select = (event: React.MouseEvent<HTMLButtonElement>, item: Frame3DSingleSelection) =>
    props.setSelection(toggleFrame3DSelection(props.selection, item, event.shiftKey || event.ctrlKey || event.metaKey));

  return <div className="fem-project-tree" data-frame3d-explorer>
    <div className="fem-tree-tabs">
      <button className={`fem-tree-tab${tab === "project" ? " active" : ""}`} onClick={() => setTab("project")}>{t("tree.projectTab")}</button>
      <button className={`fem-tree-tab${tab === "view" ? " active" : ""}`} onClick={() => setTab("view")}>{t("tree.viewTab")}</button>
      <button className={`fem-tree-tab${tab === "results" ? " active" : ""}`} onClick={() => setTab("results")}>{t("tree.resultsTab")}</button>
    </div>
    <div className="fem-tree-body">
      {tab === "project" && <>
        <ItemBranch label={t("tree.nodes")} items={props.model.nodes}
          showNextLabel={(count) => t("tree.showNext", { count })} renderItem={(node) =>
          <Leaf key={node.id} label={t("tree.nodeLabel", { id: node.id })}
            value={`X:${node.x} Y:${node.y} Z:${node.z}`}
            active={frame3DSelectionContains(props.selection, "node", node.id)}
            onClick={(event) => select(event, { type: "node", id: node.id })} />
        } />
        <ItemBranch label={t("tree.elements")} items={props.model.beams}
          showNextLabel={(count) => t("tree.showNext", { count })} renderItem={(beam) =>
          <Leaf key={beam.id} label={t("tree.barLabel", { id: beam.id })}
            value={`${beam.startNodeId}-${beam.endNodeId} · ${beam.profileName ?? "—"}`}
            active={frame3DSelectionContains(props.selection, "beam", beam.id)}
            onClick={(event) => select(event, { type: "beam", id: beam.id })} />
        } />
        <Branch label="Platen" count={(props.model.plates ?? []).length}
          showNextLabel={(count) => t("tree.showNext", { count })}>
          {(props.model.plates ?? []).map((plate) => <Leaf key={plate.id} label={`Plaat ${plate.id}`}
            value={plate.boundary
              ? `${plate.boundary.length} segmenten · ${plate.boundary.filter((segment) => segment.kind === "arc").length} boog · ${plate.thicknessM} m · ${plate.openings?.length ?? 0} openingen`
              : `${plate.nodeIds.length} hoeken · ${plate.thicknessM} m · ${plate.openings?.length ?? 0} openingen`}
            active={frame3DSelectionContains(props.selection, "plate", plate.id)}
            onClick={(event) => select(event, { type: "plate", id: plate.id })} />)}
        </Branch>
        <Branch label={t("tree.supports")} count={(props.model.supports ?? []).length}
          showNextLabel={(count) => t("tree.showNext", { count })}>
          {(props.model.supports ?? []).map((support) => <Leaf key={support.nodeId}
            label={t("tree.nodeLabel", { id: support.nodeId })}
            value={[
              t(`tree.support.${frame3DSupportPresetOf(support)}`, frame3DSupportPresetOf(support)),
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
            active={frame3DSelectionContains(props.selection, "node", support.nodeId)}
            onClick={(event) => select(event, { type: "node", id: support.nodeId })} />)}
        </Branch>
        <Branch label={t("tree.loads")} count={nodalLoads.length + memberLoads.length + memberPointLoads.length + thermalLoads.length + surfaceLoads.length}
          showNextLabel={(count) => t("tree.showNext", { count })}>
          {nodalLoads.map((load) => <Leaf key={load.id} label={`#${load.id} · ${t("tree.nodeLabel", { id: load.nodeId })}`}
            value={[load.fx && `Fx ${load.fx}`, load.fy && `Fy ${load.fy}`, load.fz && `Fz ${load.fz}`, load.mx && `Mx ${load.mx}`, load.my && `My ${load.my}`, load.mz && `Mz ${load.mz}`].filter(Boolean).join(" · ")}
            active={frame3DSelectionContains(props.selection, "nodalLoad", load.id)}
            onClick={(event) => select(event, { type: "nodalLoad", id: load.id })} />)}
          {memberLoads.map((load) => <Leaf key={`member-${load.id}`}
            label={`#${load.id} · ${t("tree.barLabel", { id: load.beamId })}`}
            value={[
              load.qyStart !== 0 || load.qyEnd !== 0 ? `qy ${load.qyStart}→${load.qyEnd}` : "",
              load.qzStart !== 0 || load.qzEnd !== 0 ? `qz ${load.qzStart}→${load.qzEnd}` : "",
              `${load.startPositionM}–${load.endPositionM} m`,
            ].filter(Boolean).join(" · ")}
            active={frame3DSelectionContains(props.selection, "memberLoad", load.id)}
            onClick={(event) => select(event, { type: "memberLoad", id: load.id })} />)}
          {memberPointLoads.map((load) => <Leaf key={`member-point-${load.id}`}
            label={`P#${load.id} · ${t("tree.barLabel", { id: load.beamId })}`}
            value={[load.py && `Py ${load.py}`, load.pz && `Pz ${load.pz}`, `x ${load.positionM} m`].filter(Boolean).join(" · ")}
            active={frame3DSelectionContains(props.selection, "memberPointLoad", load.id)}
            onClick={(event) => select(event, { type: "memberPointLoad", id: load.id })} />)}
          {thermalLoads.map((load) => <Leaf key={`thermal-${load.id}`}
            label={`ΔT#${load.id} · ${t("tree.barLabel", { id: load.beamId })}`}
            value={`uniform ${load.deltaTUniformK} K · y ${load.deltaTGradientYK} K · z ${load.deltaTGradientZK} K`}
            active={frame3DSelectionContains(props.selection, "thermalLoad", load.id)}
            onClick={(event) => select(event, { type: "thermalLoad", id: load.id })} />)}
          {surfaceLoads.map((load) => <Leaf key={`surface-${load.id}`}
            label={`q#${load.id} · Plaat ${load.plateId}`}
            value={`qx ${load.qx} · qy ${load.qy} · qz ${load.qz} kN/m²`}
            active={frame3DSelectionContains(props.selection, "surfaceLoad", load.id)}
            onClick={(event) => select(event, { type: "surfaceLoad", id: load.id })} />)}
        </Branch>
      </>}
      {tab === "view" && <ExplorerViewTab
        displayFlags={props.displayFlags} setDisplayFlags={props.setDisplayFlags}
        gridShow={props.gridShow} setGridShow={props.setGridShow}
        stramienAan={props.structuralGrid.enabled} setStramienAan={props.setStructuralGridEnabled}
        frame3dVisibility={props.visibility} setFrame3DVisibility={props.setVisibility} workspace="3d"
      />}
      {tab === "results" && <div className="fem-results-tab" data-frame3d-results-tab>
        <div className="fem-results-section-title">{t("tree.resultsTab")}</div>
        {props.result ? <div className="fem-results-hint">
          {props.result.analysis === "p-delta" ? "2e orde (P-Δ)" : "1e orde"} · Δmax {(maxDisplacement * 1000).toFixed(3)} mm · αcr {alphaCr?.toFixed(2) ?? "—"}
          {maxSteelUc !== undefined && <> · UC staal {maxSteelUc.toFixed(2)}</>}
          {maxConcreteUc !== undefined && <> · UC UGT beton {maxConcreteUc.toFixed(2)}</>}
          {props.checksRunning && <> · normtoetsing…</>}
          {props.checksError && <><br />Normtoetsing: {props.checksError}</>}
        </div> : <div className="fem-results-hint">{t("tree.clickCalculateBefore")} <strong>{t("tree.calculate")}</strong>.</div>}
        {(props.combinations?.length ?? 0) > 0 && (props.combinationResults?.size ?? 0) > 0 && <Branch
          label="Belastingcombinaties"
          count={props.combinationResults?.size ?? 0}
          showNextLabel={(count) => t("tree.showNext", { count })}
        >
          {props.combinations?.filter((combination) => props.combinationResults?.has(combination.id)).map((combination) => {
            const result = props.combinationResults?.get(combination.id);
            const displacement = result ? frame3DMaximumDisplacementM(props.model, result) : 0;
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
          {RESULT_KEYS.map((key) => <button key={key} type="button"
            className={`fem-results-toggle${props.visibility[key] ? " active" : ""}`}
            onClick={() => props.setVisibility({ ...props.visibility, [key]: !props.visibility[key] })}>
            <span className="fem-results-toggle-swatch" style={{ background: key === "deformation" ? "#dc2626" : key === "reactions" ? "#16a34a" : key === "utilization" ? "linear-gradient(90deg,#16a34a 0 25%,#84cc16 25% 50%,#f59e0b 50% 75%,#dc2626 75%)" : "#d97706" }} />
            <span className="fem-results-toggle-label">{t(`frame3dVisibility.${key}`)}</span>
            <span className={`fem-switch${props.visibility[key] ? " on" : ""}`}><span className="fem-switch-dot" /></span>
          </button>)}
        </div>
      </div>}
    </div>
  </div>;
}
