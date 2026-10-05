import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../Modal";
import {
  DEFAULT_OPEN_FEM_3D_VISIBILITY, OPEN_FEM_3D_RESULT_LAYERS, type OpenFem3DVisibility, type OpenFem3DVisibilityFlag,
} from "./openFem3dVisibility";
import OpenFem3DSymbolScaleControl from "./OpenFem3DSymbolScaleControl";
import OpenFem3DPlateDisplayChoice from "./OpenFem3DPlateDisplayChoice";
import "./OpenFem3DEditor.css";
import { bewaarOpenFem3DViewSet, type OpenFem3DCameraState, type OpenFem3DViewSet } from "./openFem3dViewSets";
import type { OpenFem3DView } from "./openFem3dCommands";
import type { OpenFem3DDiagramLabels } from "./openFem3dDiagramLabels";

interface Props {
  open: boolean;
  onClose: () => void;
  visibility: OpenFem3DVisibility;
  onChange: (visibility: OpenFem3DVisibility) => void;
  viewSets: OpenFem3DViewSet[];
  currentView: OpenFem3DView;
  currentCamera: OpenFem3DCameraState;
  currentCombinationId: number | null;
  currentLoadCaseId: number;
  currentMode: "model" | "loadCase" | "results";
  /** De getallen bij de snedekrachtlijnen; gaan mee in een opgeslagen view. */
  currentDiagramLabels?: OpenFem3DDiagramLabels;
  combinationOptions: { id: number; name: string }[];
  loadCaseOptions: { id: number; name: string }[];
  onViewSetsChange?: (viewSets: OpenFem3DViewSet[]) => void;
  onApplyViewSet?: (viewSet: OpenFem3DViewSet) => void;
}

const GROUPS: { title: string; keys: readonly OpenFem3DVisibilityFlag[] }[] = [
  // Onder Platen de keuze Volume, Vlak of Mesh (issue #78), geen schakelaar.
  { title: "geometry", keys: ["nodes", "beams", "plates", "profiles", "profileColors", "supports", "loads", "loadPanels"] },
  { title: "labels", keys: ["nodeNumbers", "beamNumbers", "nodeCoordinates"] },
  // Peilmaten direct onder het stramien, maar los ervan te schakelen (issue #92).
  { title: "workspace", keys: ["grid", "structuralGrid", "levelMarks", "axes", "memberAxes", "viewCube", "perspective"] },
  { title: "results", keys: OPEN_FEM_3D_RESULT_LAYERS },
];

export default function OpenFem3DVisibilityDialog({
  open, onClose, visibility, onChange, viewSets, currentView, currentCamera,
  currentCombinationId, currentLoadCaseId, currentMode, currentDiagramLabels, combinationOptions, loadCaseOptions,
  onViewSetsChange, onApplyViewSet,
}: Props) {
  const { t } = useTranslation("common");
  const [name, setName] = useState("");
  useEffect(() => { if (open && !name) setName(t("openFem3dVisibility.defaultViewName", { n: viewSets.length + 1 })); }, [open, viewSets.length]);
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || !onViewSetsChange) return;
    // Dezelfde opslagregel als de tab Views van de verkenner (openFem3dViewSets.ts).
    const existing = viewSets.some((item) => item.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    onViewSetsChange(bewaarOpenFem3DViewSet(viewSets, trimmed, {
      view: currentView, camera: currentCamera, visibility,
      combinationId: currentCombinationId, loadCaseId: currentLoadCaseId, mode: currentMode,
      ...(currentDiagramLabels === undefined ? {} : { diagramLabels: currentDiagramLabels }),
    }));
    setName(t("openFem3dVisibility.defaultViewName", { n: viewSets.length + (existing ? 0 : 2) }));
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("openFem3dVisibility.title")}
      width={560}
      className="open-fem3d-visibility-dialog"
      footer={
        <>
          <span className="open-fem3d-visibility-note">{t("openFem3dVisibility.remembered")}</span>
          <button type="button" onClick={() => onChange({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY })}>{t("zichtbaarheid.standaard")}</button>
          <button type="button" className="primary" onClick={onClose}>{t("close")}</button>
        </>
      }
    >
      <section className="open-fem3d-viewsets" aria-label={t("openFem3dVisibility.viewSetsAria")}>
        <h3>{t("openFem3dVisibility.viewSetsTitle")}</h3>
        <p>{t("openFem3dVisibility.viewSetsHint")}</p>
        <div className="open-fem3d-viewset-save">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("openFem3dVisibility.viewSetName")}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); save(); } }} />
          <button type="button" onClick={save} disabled={!name.trim() || !onViewSetsChange}>{t("save")}</button>
        </div>
        {viewSets.length === 0 ? <p className="open-fem3d-viewset-empty">{t("openFem3dVisibility.noViewSets")}</p> :
          <div className="open-fem3d-viewset-list">{viewSets.map((viewSet) => {
            const combination = viewSet.combinationId === null
              ? loadCaseOptions.find((item) => item.id === viewSet.loadCaseId)?.name ?? t("openFem3dVisibility.activeLoadCase")
              : combinationOptions.find((item) => item.id === viewSet.combinationId)?.name ?? t("openFem3dVisibility.combinationN", { id: viewSet.combinationId });
            return <div key={viewSet.id} className="open-fem3d-viewset-row">
              <button type="button" className="open-fem3d-viewset-apply" onClick={() => onApplyViewSet?.(viewSet)}>
                <strong>{viewSet.name}</strong><span>{viewSet.view} · {viewSet.mode === "model" ? t("openFem3dVisibility.modeModel") : viewSet.mode === "results" ? t("openFem3dVisibility.modeResults") : viewSet.mode === "loadCase" ? t("openFem3dVisibility.modeLoadCase") : t("openFem3dVisibility.modeCurrent")} · {combination}</span>
              </button>
              <button type="button" aria-label={t("openFem3dVisibility.deleteViewSet", { name: viewSet.name })} title={t("delete")}
                onClick={() => onViewSetsChange?.(viewSets.filter((item) => item.id !== viewSet.id))}>×</button>
            </div>;
          })}</div>}
      </section>
      <div className="open-fem3d-visibility-groups">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{t(`openFem3dVisibility.${group.title}`)}</h3>
            {group.keys.map((key) => {
              // Onder Knopen en Opleggingen de regelaar Grootte (issue #82).
              const schaal = key === "nodes" ? "nodeSizePercent" : key === "supports" ? "supportSizePercent" : null;
              return <Fragment key={key}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={visibility[key]}
                  className="open-fem3d-visibility-row"
                  data-vlag={key}
                  onClick={() => onChange({ ...visibility, [key]: !visibility[key] })}
                >
                  <span>{t(`openFem3dVisibility.${key}`)}</span>
                  <span className={`open-fem3d-visibility-switch${visibility[key] ? " on" : ""}`} aria-hidden="true" />
                </button>
                {schaal && (key === "nodes" || key === "supports") && <OpenFem3DSymbolScaleControl variant="dialog"
                  target={key} percent={visibility[schaal]} disabled={!visibility[key]}
                  onChange={(percent) => onChange({ ...visibility, [schaal]: percent })} />}
                {key === "plates" && <OpenFem3DPlateDisplayChoice variant="dialog" value={visibility.plateDisplay}
                  dimmed={!visibility.plates} onChange={(plateDisplay) => onChange({ ...visibility, plateDisplay })} />}
              </Fragment>;
            })}
          </section>
        ))}
      </div>
    </Modal>
  );
}
