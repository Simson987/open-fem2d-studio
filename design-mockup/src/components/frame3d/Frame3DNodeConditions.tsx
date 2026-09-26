import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  FRAME3D_SUPPORT_PRESETS,
  addFrame3DNodalLoad,
  removeFrame3DNodalLoad,
  removeFrame3DSupport,
  setFrame3DSupport,
  setFrame3DSupportPrescribed,
  setFrame3DSupportSprings,
  updateFrame3DNodalLoad,
  type Frame3DModel,
  type Frame3DNodalLoad,
  type Frame3DNodalLoadComponents,
  type Frame3DSupportPreset,
  type Frame3DPrescribedDisplacements,
  type Frame3DSupportRestraints,
  type Frame3DSupportSprings,
} from "./frame3dModel";
import "./Frame3DNodeConditions.css";

export interface Frame3DLoadEditorRequest {
  kind: "force" | "moment";
  /** Increment for every ribbon click, including repeated clicks of the same button. */
  serial: number;
}

export interface Frame3DSpringEditorRequest {
  axis: "kx" | "ky" | "kz" | "krx" | "kry" | "krz";
  serial: number;
}

interface Props {
  model: Frame3DModel;
  nodeId: number;
  onChange: (model: Frame3DModel) => void;
  loadEditorRequest?: Frame3DLoadEditorRequest | null;
  springEditorRequest?: Frame3DSpringEditorRequest | null;
  activeLoadCaseId?: number;
  selectedLoadId?: number;
}

const SUPPORT_AXES = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const FORCE_AXES = ["fx", "fy", "fz"] as const;
const MOMENT_AXES = ["mx", "my", "mz"] as const;
const LOAD_AXES = [...FORCE_AXES, ...MOMENT_AXES] as const;
type LoadAxis = typeof LOAD_AXES[number];
const SPRING_AXES = [
  { axis: "kx", key: "kxKnPerM", label: "Kx", unit: "kN/mm", factor: 1000 },
  { axis: "ky", key: "kyKnPerM", label: "Ky", unit: "kN/mm", factor: 1000 },
  { axis: "kz", key: "kzKnPerM", label: "Kz", unit: "kN/mm", factor: 1000 },
  { axis: "krx", key: "krxKnmPerRad", label: "Krx", unit: "kNm/rad", factor: 1 },
  { axis: "kry", key: "kryKnmPerRad", label: "Kry", unit: "kNm/rad", factor: 1 },
  { axis: "krz", key: "krzKnmPerRad", label: "Krz", unit: "kNm/rad", factor: 1 },
] as const;
type SpringAxis = typeof SPRING_AXES[number]["axis"];
const PRESCRIBED_AXES = [
  { key: "uxM", label: "Ux", unit: "mm", factor: 0.001 },
  { key: "uyM", label: "Uy", unit: "mm", factor: 0.001 },
  { key: "uzM", label: "Uz", unit: "mm", factor: 0.001 },
  { key: "rxRad", label: "Rx", unit: "mrad", factor: 0.001 },
  { key: "ryRad", label: "Ry", unit: "mrad", factor: 0.001 },
  { key: "rzRad", label: "Rz", unit: "mrad", factor: 0.001 },
] as const;
type PrescribedAxis = typeof PRESCRIBED_AXES[number]["key"];

const FREE: Frame3DSupportRestraints = {
  ux: false, uy: false, uz: false, rx: false, ry: false, rz: false,
};
const ZERO_LOAD: Record<LoadAxis, string> = {
  fx: "0", fy: "0", fz: "0", mx: "0", my: "0", mz: "0",
};

function loadValues(load: Frame3DNodalLoad): Record<LoadAxis, string> {
  return Object.fromEntries(LOAD_AXES.map((axis) => [axis, String(load[axis])])) as Record<LoadAxis, string>;
}

function describeLoad(load: Frame3DNodalLoad): string {
  return LOAD_AXES.filter((axis) => load[axis] !== 0)
    .map((axis) => `${axis.toUpperCase()} ${load[axis]}`).join(" · ");
}

/** Edit the six 3D restraints and six global nodal-load components. */
export default function Frame3DNodeConditions({ model, nodeId, onChange, loadEditorRequest, springEditorRequest, activeLoadCaseId = 1, selectedLoadId }: Props) {
  const { t } = useTranslation("ribbon");
  const support = model.supports?.find((item) => item.nodeId === nodeId);
  const nodeLoads = (model.loads ?? []).filter((load) =>
    load.nodeId === nodeId && (load.caseId ?? 1) === activeLoadCaseId);
  const [restraints, setRestraints] = useState<Frame3DSupportRestraints>(support ? { ...support } : { ...FREE });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [values, setValues] = useState<Record<LoadAxis, string>>({ ...ZERO_LOAD });
  const [springValues, setSpringValues] = useState<Record<SpringAxis, string>>({
    kx: "", ky: "", kz: "", krx: "", kry: "", krz: "",
  });
  const [prescribedValues, setPrescribedValues] = useState<Record<PrescribedAxis, string>>({
    uxM: "", uyM: "", uzM: "", rxRad: "", ryRad: "", rzRad: "",
  });
  const [error, setError] = useState("");
  const firstForce = useRef<HTMLInputElement>(null);
  const firstMoment = useRef<HTMLInputElement>(null);
  const springInputs = useRef<Partial<Record<SpringAxis, HTMLInputElement | null>>>({});

  useEffect(() => {
    setRestraints(support ? { ...support } : { ...FREE });
    setSpringValues(Object.fromEntries(SPRING_AXES.map(({ axis, key, factor }) => [
      axis,
      support?.springs?.[key] === undefined ? "" : String(support.springs[key]! / factor),
    ])) as Record<SpringAxis, string>);
    setPrescribedValues(Object.fromEntries(PRESCRIBED_AXES.map(({ key, factor }) => [
      key,
      support?.prescribed?.[key] === undefined ? "" : String(support.prescribed[key]! / factor),
    ])) as Record<PrescribedAxis, string>);
  }, [
    nodeId, support?.ux, support?.uy, support?.uz, support?.rx, support?.ry, support?.rz,
    support?.springs?.kxKnPerM, support?.springs?.kyKnPerM, support?.springs?.kzKnPerM,
    support?.springs?.krxKnmPerRad, support?.springs?.kryKnmPerRad, support?.springs?.krzKnmPerRad,
    support?.prescribed?.uxM, support?.prescribed?.uyM, support?.prescribed?.uzM,
    support?.prescribed?.rxRad, support?.prescribed?.ryRad, support?.prescribed?.rzRad,
  ]);

  useEffect(() => {
    if (!springEditorRequest) return;
    const frame = requestAnimationFrame(() => springInputs.current[springEditorRequest.axis]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [springEditorRequest?.serial]);

  useEffect(() => {
    setEditingId(null);
    setValues({ ...ZERO_LOAD });
    setError("");
  }, [nodeId, activeLoadCaseId]);

  useEffect(() => {
    if (!loadEditorRequest) return;
    setEditingId(null);
    setValues({ ...ZERO_LOAD });
    setError("");
    const frame = requestAnimationFrame(() => {
      (loadEditorRequest.kind === "force" ? firstForce : firstMoment).current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [loadEditorRequest?.serial]);

  const saveSupport = (event: FormEvent) => {
    event.preventDefault();
    if (!SUPPORT_AXES.some((axis) => restraints[axis])) {
      setError(t("frame3d.noRestraint"));
      return;
    }
    onChange(setFrame3DSupport(model, nodeId, restraints));
    setError("");
  };

  const usePreset = (preset: Frame3DSupportPreset) => {
    const next = { ...FRAME3D_SUPPORT_PRESETS[preset] };
    setRestraints(next);
    onChange(setFrame3DSupport(model, nodeId, next));
    setError("");
  };

  const clearSupport = () => {
    setRestraints({ ...FREE });
    onChange(removeFrame3DSupport(model, nodeId));
    setError("");
  };

  const saveSprings = (event: FormEvent) => {
    event.preventDefault();
    const springs: Frame3DSupportSprings = {};
    for (const { axis, key, factor } of SPRING_AXES) {
      const raw = springValues[axis].trim();
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        setError("Veerstijfheden moeten leeg of positief zijn.");
        return;
      }
      springs[key] = value * factor;
    }
    onChange(setFrame3DSupportSprings(model, nodeId, springs));
    setError("");
  };

  const savePrescribed = (event: FormEvent) => {
    event.preventDefault();
    const prescribed: Frame3DPrescribedDisplacements = {};
    for (const { key, factor } of PRESCRIBED_AXES) {
      const raw = prescribedValues[key].trim();
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        setError("Opgelegde verplaatsingen moeten leeg of een geldig getal zijn.");
        return;
      }
      if (value !== 0) prescribed[key] = value * factor;
    }
    onChange(setFrame3DSupportPrescribed(model, nodeId, prescribed));
    setError("");
  };

  const selectLoad = (load: Frame3DNodalLoad) => {
    setEditingId(load.id);
    setValues(loadValues(load));
    setError("");
  };

  const newLoad = () => {
    setEditingId(null);
    setValues({ ...ZERO_LOAD });
    setError("");
    firstForce.current?.focus();
  };

  const saveLoad = (event: FormEvent) => {
    event.preventDefault();
    if (LOAD_AXES.some((axis) => values[axis].trim() === "")) {
      setError(t("frame3d.invalidLoad"));
      return;
    }
    const components = Object.fromEntries(LOAD_AXES.map((axis) => [axis, Number(values[axis])])) as
      unknown as Frame3DNodalLoadComponents;
    if (LOAD_AXES.some((axis) => !Number.isFinite(components[axis])) ||
        LOAD_AXES.every((axis) => components[axis] === 0)) {
      setError(t("frame3d.invalidLoad"));
      return;
    }
    const updated = editingId === null
      ? addFrame3DNodalLoad(model, nodeId, components, activeLoadCaseId)
      : updateFrame3DNodalLoad(model, editingId, components);
    onChange(updated);
    if (editingId === null) {
      const loads = updated.loads ?? [];
      setEditingId(loads[loads.length - 1]?.id ?? null);
    }
    setError("");
  };

  const deleteLoad = (id: number) => {
    onChange(removeFrame3DNodalLoad(model, id));
    if (editingId === id) {
      setEditingId(null);
      setValues({ ...ZERO_LOAD });
    }
    setError("");
  };

  useEffect(() => {
    if (selectedLoadId === undefined) return;
    const selected = nodeLoads.find((load) => load.id === selectedLoadId);
    if (selected) selectLoad(selected);
  }, [selectedLoadId, nodeId, activeLoadCaseId]);

  return (
    <div className="frame3d-conditions">
      <section>
        <h3>{t("frame3d.support")}</h3>
        <div className="frame3d-condition-presets">
          <button type="button" onClick={() => usePreset("pinned")}>{t("home.pinned")}</button>
          <button type="button" onClick={() => usePreset("fixed")}>{t("home.fixed")}</button>
          <button type="button" onClick={() => usePreset("xRoller")}>{t("home.xRoller")}</button>
          <button type="button" onClick={() => usePreset("yRoller")}>{t("frame3d.yRoller", "Y-rol")}</button>
          <button type="button" onClick={() => usePreset("zRoller")}>{t("home.zRoller")}</button>
          <button type="button" onClick={() => usePreset("revoluteX")}>{t("frame3d.revoluteX")}</button>
          <button type="button" onClick={() => usePreset("revoluteY")}>{t("frame3d.revoluteY")}</button>
          <button type="button" onClick={() => usePreset("revoluteZ")}>{t("frame3d.revoluteZ")}</button>
          <button type="button" onClick={clearSupport}>{t("frame3d.free")}</button>
        </div>
        <form onSubmit={saveSupport}>
          <div className="frame3d-support-grid">
            {SUPPORT_AXES.map((axis) => (
              <label key={axis}>
                <input type="checkbox" checked={restraints[axis]}
                  onChange={(event) => setRestraints({ ...restraints, [axis]: event.target.checked })} />
                <span>{axis.toUpperCase()}</span>
              </label>
            ))}
          </div>
          <button type="submit">{t("frame3d.apply")}</button>
        </form>
        <form onSubmit={saveSprings}>
          <fieldset>
            <legend>Oplegveren · globale assen</legend>
            <div className="frame3d-condition-values frame3d-spring-values">
              {SPRING_AXES.map(({ axis, label, unit }) => <label key={axis}>
                <span>{label} ({unit})</span>
                <input ref={(element) => { springInputs.current[axis] = element; }} type="number" min="0" step="any"
                  placeholder="vrij" value={springValues[axis]}
                  onChange={(event) => setSpringValues({ ...springValues, [axis]: event.target.value })} />
              </label>)}
            </div>
          </fieldset>
          <button type="submit">Veren toepassen</button>
        </form>
        <form onSubmit={savePrescribed}>
          <fieldset>
            <legend>Opgelegde verplaatsing · globale assen</legend>
            <div className="frame3d-condition-values frame3d-spring-values">
              {PRESCRIBED_AXES.map(({ key, label, unit }) => <label key={key}>
                <span>{label} ({unit})</span>
                <input type="number" step="any" placeholder="0" value={prescribedValues[key]}
                  onChange={(event) => setPrescribedValues({ ...prescribedValues, [key]: event.target.value })} />
              </label>)}
            </div>
          </fieldset>
          <button type="submit">Verplaatsingen toepassen</button>
        </form>
      </section>

      <section>
        <h3>{t("frame3d.nodalLoad")}</h3>
        {nodeLoads.length > 0 && <div className="frame3d-condition-load-list">
          {nodeLoads.map((load) => (
            <div key={load.id} className={editingId === load.id ? "selected" : ""}>
              <button type="button" onClick={() => selectLoad(load)}>
                <strong>#{load.id}</strong> {describeLoad(load)}
              </button>
              <button type="button" onClick={() => deleteLoad(load.id)}
                aria-label={`${t("frame3d.deleteLoad")} ${load.id}`}>×</button>
            </div>
          ))}
        </div>}
        <button className="frame3d-condition-new" type="button" onClick={newLoad}>
          {t("frame3d.addLoad")}
        </button>
        <form onSubmit={saveLoad}>
          <fieldset>
            <legend>{t("frame3d.force")} ({t("frame3d.forceUnit")})</legend>
            <div className="frame3d-condition-values">
              {FORCE_AXES.map((axis) => (
                <label key={axis}><span>{axis.toUpperCase()}</span>
                  <input ref={axis === "fx" ? firstForce : undefined} type="number" step="any" required
                    value={values[axis]}
                    onChange={(event) => setValues({ ...values, [axis]: event.target.value })} />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t("frame3d.moment")} ({t("frame3d.momentUnit")})</legend>
            <div className="frame3d-condition-values">
              {MOMENT_AXES.map((axis) => (
                <label key={axis}><span>{axis.toUpperCase()}</span>
                  <input ref={axis === "mx" ? firstMoment : undefined} type="number" step="any" required
                    value={values[axis]}
                    onChange={(event) => setValues({ ...values, [axis]: event.target.value })} />
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit">{t(editingId === null ? "frame3d.addLoad" : "frame3d.saveLoad")}</button>
        </form>
        {error && <p className="frame3d-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
