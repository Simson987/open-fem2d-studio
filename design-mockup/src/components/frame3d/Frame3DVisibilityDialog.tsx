import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../Modal";
import { DEFAULT_FRAME_3D_VISIBILITY, type Frame3DVisibility } from "./frame3dVisibility";
import "./Frame3DEditor.css";
import { newFrame3DViewSetId, type Frame3DCameraState, type Frame3DViewSet } from "./frame3dViewSets";
import type { Frame3DView } from "./frame3dCommands";

interface Props {
  open: boolean;
  onClose: () => void;
  visibility: Frame3DVisibility;
  onChange: (visibility: Frame3DVisibility) => void;
  viewSets: Frame3DViewSet[];
  currentView: Frame3DView;
  currentCamera: Frame3DCameraState;
  currentCombinationId: number | null;
  currentLoadCaseId: number;
  currentMode: "model" | "loadCase" | "results";
  combinationOptions: { id: number; name: string }[];
  loadCaseOptions: { id: number; name: string }[];
  onViewSetsChange?: (viewSets: Frame3DViewSet[]) => void;
  onApplyViewSet?: (viewSet: Frame3DViewSet) => void;
}

const GROUPS: { title: string; keys: (keyof Frame3DVisibility)[] }[] = [
  { title: "geometry", keys: ["nodes", "beams", "plates", "profiles", "supports", "loads"] },
  { title: "labels", keys: ["nodeNumbers", "beamNumbers", "nodeCoordinates"] },
  { title: "workspace", keys: ["grid", "structuralGrid", "axes", "memberAxes"] },
  { title: "results", keys: ["deformation", "reactions", "utilization", "axialForce", "shearY", "shearZ", "torsion", "momentY", "momentZ"] },
];

export default function Frame3DVisibilityDialog({
  open, onClose, visibility, onChange, viewSets, currentView, currentCamera,
  currentCombinationId, currentLoadCaseId, currentMode, combinationOptions, loadCaseOptions,
  onViewSetsChange, onApplyViewSet,
}: Props) {
  const { t } = useTranslation("common");
  const [name, setName] = useState("");
  useEffect(() => { if (open && !name) setName(`Weergave ${viewSets.length + 1}`); }, [open, viewSets.length]);
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || !onViewSetsChange) return;
    const existing = viewSets.find((item) => item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    const viewSet: Frame3DViewSet = {
      id: existing?.id ?? newFrame3DViewSetId(viewSets),
      name: trimmed,
      view: currentView,
      camera: {
        position: [...currentCamera.position], target: [...currentCamera.target], up: [...currentCamera.up],
      },
      visibility: { ...visibility },
      combinationId: currentCombinationId,
      loadCaseId: currentLoadCaseId,
      mode: currentMode,
    };
    onViewSetsChange(existing
      ? viewSets.map((item) => item.id === existing.id ? viewSet : item)
      : [...viewSets, viewSet]);
    setName(`Weergave ${viewSets.length + (existing ? 0 : 2)}`);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("frame3dVisibility.title")}
      width={560}
      className="frame3d-visibility-dialog"
      footer={
        <>
          <span className="frame3d-visibility-note">{t("frame3dVisibility.remembered")}</span>
          <button type="button" onClick={() => onChange({ ...DEFAULT_FRAME_3D_VISIBILITY })}>{t("zichtbaarheid.standaard")}</button>
          <button type="button" className="primary" onClick={onClose}>{t("close")}</button>
        </>
      }
    >
      <section className="frame3d-viewsets" aria-label="Opgeslagen 3D-weergaven">
        <h3>Opgeslagen views</h3>
        <p>Bewaar de camera, tabstand, resultaatcombinatie en alle onderstaande zichtbaarheidsschakelaars samen.</p>
        <div className="frame3d-viewset-save">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Naam van de view"
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); save(); } }} />
          <button type="button" onClick={save} disabled={!name.trim() || !onViewSetsChange}>Opslaan</button>
        </div>
        {viewSets.length === 0 ? <p className="frame3d-viewset-empty">Nog geen views opgeslagen.</p> :
          <div className="frame3d-viewset-list">{viewSets.map((viewSet) => {
            const combination = viewSet.combinationId === null
              ? loadCaseOptions.find((item) => item.id === viewSet.loadCaseId)?.name ?? "actief belastinggeval"
              : combinationOptions.find((item) => item.id === viewSet.combinationId)?.name ?? `combinatie ${viewSet.combinationId}`;
            return <div key={viewSet.id} className="frame3d-viewset-row">
              <button type="button" className="frame3d-viewset-apply" onClick={() => onApplyViewSet?.(viewSet)}>
                <strong>{viewSet.name}</strong><span>{viewSet.view} · {viewSet.mode === "model" ? "model" : viewSet.mode === "results" ? "resultaten" : viewSet.mode === "loadCase" ? "belastinggeval" : "huidige tabstand"} · {combination}</span>
              </button>
              <button type="button" aria-label={`${viewSet.name} verwijderen`} title="Verwijderen"
                onClick={() => onViewSetsChange?.(viewSets.filter((item) => item.id !== viewSet.id))}>×</button>
            </div>;
          })}</div>}
      </section>
      <div className="frame3d-visibility-groups">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{t(`frame3dVisibility.${group.title}`)}</h3>
            {group.keys.map((key) => (
              <button
                key={key}
                type="button"
                role="switch"
                aria-checked={visibility[key]}
                className="frame3d-visibility-row"
                data-vlag={key}
                onClick={() => onChange({ ...visibility, [key]: !visibility[key] })}
              >
                <span>{t(`frame3dVisibility.${key}`)}</span>
                <span className={`frame3d-visibility-switch${visibility[key] ? " on" : ""}`} aria-hidden="true" />
              </button>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
