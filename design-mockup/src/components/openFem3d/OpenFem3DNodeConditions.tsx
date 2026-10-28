import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  OPEN_FEM_3D_SUPPORT_PRESETS,
  addOpenFem3DNodalLoad,
  openFem3DSupportPresetOf,
  removeOpenFem3DNodalLoad,
  removeOpenFem3DSupport,
  setOpenFem3DSupport,
  setOpenFem3DSupportPrescribed,
  setOpenFem3DSupportSprings,
  updateOpenFem3DNodalLoad,
  type OpenFem3DModel,
  type OpenFem3DNodalLoad,
  type OpenFem3DNodalLoadComponents,
  type OpenFem3DSupportPreset,
  type OpenFem3DPrescribedDisplacements,
  type OpenFem3DSupportRestraints,
  type OpenFem3DSupportSprings,
} from "./openFem3dModel";
import { rememberOpenFem3DSpringStiffness } from "./openFem3dNodeTools";
import type { OpenFem3DSpringAxis } from "./openFem3dCommands";
import "./OpenFem3DNodeConditions.css";

export interface OpenFem3DLoadEditorRequest {
  kind: "force" | "moment";
  /** Increment for every ribbon click, including repeated clicks of the same button. */
  serial: number;
}

export interface OpenFem3DSpringEditorRequest {
  axis: OpenFem3DSpringAxis;
  serial: number;
}

interface Props {
  model: OpenFem3DModel;
  nodeId: number;
  onChange: (model: OpenFem3DModel) => void;
  loadEditorRequest?: OpenFem3DLoadEditorRequest | null;
  springEditorRequest?: OpenFem3DSpringEditorRequest | null;
  activeLoadCaseId?: number;
  selectedLoadId?: number;
}

const SUPPORT_AXES = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
type SupportAxis = typeof SUPPORT_AXES[number];
const FORCE_AXES = ["fx", "fy", "fz"] as const;
const MOMENT_AXES = ["mx", "my", "mz"] as const;
const LOAD_AXES = [...FORCE_AXES, ...MOMENT_AXES] as const;
type LoadAxis = typeof LOAD_AXES[number];
const SPRING_AXES = [
  { axis: "kx", key: "kxKnPerM", factor: 1000 },
  { axis: "ky", key: "kyKnPerM", factor: 1000 },
  { axis: "kz", key: "kzKnPerM", factor: 1000 },
  { axis: "krx", key: "krxKnmPerRad", factor: 1 },
  { axis: "kry", key: "kryKnmPerRad", factor: 1 },
  { axis: "krz", key: "krzKnmPerRad", factor: 1 },
] as const;
type SpringAxis = typeof SPRING_AXES[number]["axis"];
const PRESCRIBED_AXES = [
  { key: "uxM", factor: 0.001 },
  { key: "uyM", factor: 0.001 },
  { key: "uzM", factor: 0.001 },
  { key: "rxRad", factor: 0.001 },
  { key: "ryRad", factor: 0.001 },
  { key: "rzRad", factor: 0.001 },
] as const;
type PrescribedAxis = typeof PRESCRIBED_AXES[number]["key"];

/** Standaardopleggingen in de volgorde van het lint; "Vrij" volgt apart. */
const PRESETS: readonly { preset: OpenFem3DSupportPreset; key: string }[] = [
  { preset: "pinned", key: "home.pinned" },
  { preset: "fixed", key: "home.fixed" },
  { preset: "xRoller", key: "home.xRoller" },
  { preset: "yRoller", key: "openFem3d.yRoller" },
  { preset: "zRoller", key: "home.zRoller" },
  { preset: "revoluteX", key: "openFem3d.revoluteX" },
  { preset: "revoluteY", key: "openFem3d.revoluteY" },
  { preset: "revoluteZ", key: "openFem3d.revoluteZ" },
];

const FREE: OpenFem3DSupportRestraints = {
  ux: false, uy: false, uz: false, rx: false, ry: false, rz: false,
};
const ZERO_LOAD: Record<LoadAxis, string> = {
  fx: "0", fy: "0", fz: "0", mx: "0", my: "0", mz: "0",
};

/**
 * De waarden in de invoervelden: 6 significante cijfers, zodat een afgeleide
 * waarde als -0.4514938458750002 niet als ruwe float in het veld staat.
 */
function loadValues(load: OpenFem3DNodalLoad): Record<LoadAxis, string> {
  return Object.fromEntries(LOAD_AXES.map((axis) => [axis, String(Number(load[axis].toPrecision(6)))])) as Record<LoadAxis, string>;
}

/** Korte omschrijving voor de lastlijst: hoogstens drie decimalen, met eenheid. */
function describeLoad(load: OpenFem3DNodalLoad, locale: string): string {
  const getal = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  return LOAD_AXES.filter((axis) => load[axis] !== 0)
    .map((axis) => `${axis.toUpperCase()} ${getal.format(load[axis])} ${axis.startsWith("f") ? "kN" : "kNm"}`).join(" · ");
}

/** Twee getallenverzamelingen gelijk? (Leeg en ontbrekend tellen als gelijk.) */
function gelijkeWaarden<T extends object>(a: T | undefined, b: T): boolean {
  const links = (a ?? {}) as Record<string, unknown>, rechts = b as Record<string, unknown>;
  const sleutels = new Set([...Object.keys(links), ...Object.keys(rechts)]);
  return [...sleutels].every((k) => links[k] === rechts[k]);
}

/** Enter bevestigt een veld zoals bij de coördinaten: het veld verliest de focus en schrijft weg. */
const bevestigMetEnter = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
};

/** Edit the six 3D restraints and six global nodal-load components. */
export default function OpenFem3DNodeConditions({ model, nodeId, onChange, loadEditorRequest, springEditorRequest, activeLoadCaseId = 1, selectedLoadId }: Props) {
  const { t, i18n } = useTranslation("ribbon");
  const support = model.supports?.find((item) => item.nodeId === nodeId);
  const nodeLoads = (model.loads ?? []).filter((load) =>
    load.nodeId === nodeId && (load.caseId ?? 1) === activeLoadCaseId);
  const [restraints, setRestraints] = useState<OpenFem3DSupportRestraints>(support ? { ...support } : { ...FREE });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [values, setValues] = useState<Record<LoadAxis, string>>({ ...ZERO_LOAD });
  const [springValues, setSpringValues] = useState<Record<SpringAxis, string>>({
    kx: "", ky: "", kz: "", krx: "", kry: "", krz: "",
  });
  const [prescribedValues, setPrescribedValues] = useState<Record<PrescribedAxis, string>>({
    uxM: "", uyM: "", uzM: "", rxRad: "", ryRad: "", rzRad: "",
  });
  const [supportError, setSupportError] = useState("");
  const [loadError, setLoadError] = useState("");
  const firstForce = useRef<HTMLInputElement>(null);
  const firstMoment = useRef<HTMLInputElement>(null);
  const springInputs = useRef<Partial<Record<SpringAxis, HTMLInputElement | null>>>({});

  const leesVeren = () => Object.fromEntries(SPRING_AXES.map(({ axis, key, factor }) => [
    axis,
    support?.springs?.[key] === undefined ? "" : String(support.springs[key]! / factor),
  ])) as Record<SpringAxis, string>;
  const leesOpgelegd = () => Object.fromEntries(PRESCRIBED_AXES.map(({ key, factor }) => [
    key,
    support?.prescribed?.[key] === undefined ? "" : String(support.prescribed[key]! / factor),
  ])) as Record<PrescribedAxis, string>;

  useEffect(() => {
    setRestraints(support ? { ...support } : { ...FREE });
    setSpringValues(leesVeren());
    setPrescribedValues(leesOpgelegd());
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
    setSupportError("");
    setLoadError("");
  }, [nodeId, activeLoadCaseId]);

  useEffect(() => {
    if (!loadEditorRequest) return;
    setEditingId(null);
    setValues({ ...ZERO_LOAD });
    setLoadError("");
    const frame = requestAnimationFrame(() => {
      (loadEditorRequest.kind === "force" ? firstForce : firstMoment).current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [loadEditorRequest?.serial]);

  const actievePreset = support ? openFem3DSupportPresetOf(support) : null;
  const heeftVeerOfOpgelegd = Boolean(support?.springs && Object.keys(support.springs).length > 0)
    || Boolean(support?.prescribed && Object.keys(support.prescribed).length > 0);

  /** Een vinkje werkt direct. Alles uit zonder veer of opgelegde waarde = geen oplegging. */
  const pasRichtingenToe = (next: OpenFem3DSupportRestraints) => {
    setRestraints(next);
    const vast = SUPPORT_AXES.some((axis) => next[axis]);
    onChange(!vast && !heeftVeerOfOpgelegd
      ? removeOpenFem3DSupport(model, nodeId)
      : setOpenFem3DSupport(model, nodeId, next));
    setSupportError("");
  };

  const usePreset = (preset: OpenFem3DSupportPreset) => {
    const next = { ...OPEN_FEM_3D_SUPPORT_PRESETS[preset] };
    setRestraints(next);
    onChange(setOpenFem3DSupport(model, nodeId, next));
    setSupportError("");
  };

  const clearSupport = () => {
    setRestraints({ ...FREE });
    onChange(removeOpenFem3DSupport(model, nodeId));
    setSupportError("");
  };

  /** Veren wegschrijven bij het verlaten van een veld; ongewijzigd = geen stap in ongedaan maken. */
  const bevestigVeren = () => {
    const springs: OpenFem3DSupportSprings = {};
    for (const { axis, key, factor } of SPRING_AXES) {
      const raw = springValues[axis].trim().replace(",", ".");
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        setSupportError(t("openFem3d.springsInvalid"));
        return;
      }
      springs[key] = value * factor;
    }
    setSupportError("");
    if (gelijkeWaarden(support?.springs, springs)) return;
    if (!support && Object.keys(springs).length === 0) return;
    onChange(setOpenFem3DSupportSprings(model, nodeId, springs));
    // Het veergereedschap begint de volgende keer met deze stijfheid.
    rememberOpenFem3DSpringStiffness(springs);
  };

  const bevestigOpgelegd = () => {
    const prescribed: OpenFem3DPrescribedDisplacements = {};
    for (const { key, factor } of PRESCRIBED_AXES) {
      const raw = prescribedValues[key].trim().replace(",", ".");
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        setSupportError(t("openFem3d.prescribedInvalid"));
        return;
      }
      if (value !== 0) prescribed[key] = value * factor;
    }
    setSupportError("");
    if (gelijkeWaarden(support?.prescribed, prescribed)) return;
    onChange(setOpenFem3DSupportPrescribed(model, nodeId, prescribed));
  };

  const selectLoad = (load: OpenFem3DNodalLoad) => {
    setEditingId(load.id);
    setValues(loadValues(load));
    setLoadError("");
  };

  const newLoad = () => {
    setEditingId(null);
    setValues({ ...ZERO_LOAD });
    setLoadError("");
    firstForce.current?.focus();
  };

  const saveLoad = (event: FormEvent) => {
    event.preventDefault();
    if (LOAD_AXES.some((axis) => values[axis].trim() === "")) {
      setLoadError(t("openFem3d.invalidLoad"));
      return;
    }
    const components = Object.fromEntries(LOAD_AXES.map((axis) => [axis, Number(values[axis].trim().replace(",", "."))])) as
      unknown as OpenFem3DNodalLoadComponents;
    if (LOAD_AXES.some((axis) => !Number.isFinite(components[axis])) ||
        LOAD_AXES.every((axis) => components[axis] === 0)) {
      setLoadError(t("openFem3d.invalidLoad"));
      return;
    }
    const updated = editingId === null
      ? addOpenFem3DNodalLoad(model, nodeId, components, activeLoadCaseId)
      : updateOpenFem3DNodalLoad(model, editingId, components);
    onChange(updated);
    if (editingId === null) {
      const loads = updated.loads ?? [];
      setEditingId(loads[loads.length - 1]?.id ?? null);
    }
    setLoadError("");
  };

  const deleteLoad = (id: number) => {
    onChange(removeOpenFem3DNodalLoad(model, id));
    if (editingId === id) {
      setEditingId(null);
      setValues({ ...ZERO_LOAD });
    }
    setLoadError("");
  };

  useEffect(() => {
    if (selectedLoadId === undefined) return;
    const selected = nodeLoads.find((load) => load.id === selectedLoadId);
    if (selected) selectLoad(selected);
  }, [selectedLoadId, nodeId, activeLoadCaseId]);

  const assenKop = (
    <>
      <span />
      <span className="open-fem3d-nc-head">X</span>
      <span className="open-fem3d-nc-head">Y</span>
      <span className="open-fem3d-nc-head">Z</span>
    </>
  );
  const richting = (axis: SupportAxis) => (
    <label key={axis} className={`open-fem3d-nc-dof${restraints[axis] ? " on" : ""}`}
      title={t("openFem3d.restrainedHint", { axis: axis.toUpperCase() })}>
      <input type="checkbox" className="fem-prop-checkbox" checked={restraints[axis]}
        aria-label={axis.toUpperCase()}
        onChange={(event) => pasRichtingenToe({ ...restraints, [axis]: event.target.checked })} />
    </label>
  );
  const veerVeld = (axis: SpringAxis) => (
    <input key={axis} ref={(element) => { springInputs.current[axis] = element; }}
      className="fem-prop-input open-fem3d-nc-input" inputMode="decimal"
      aria-label={axis.toUpperCase()} placeholder={t("openFem3d.springFree")} value={springValues[axis]}
      onChange={(event) => setSpringValues({ ...springValues, [axis]: event.target.value })}
      onBlur={bevestigVeren} onKeyDown={bevestigMetEnter} />
  );
  const opgelegdVeld = (key: PrescribedAxis) => (
    <input key={key} className="fem-prop-input open-fem3d-nc-input" inputMode="decimal"
      aria-label={key.replace(/M$|Rad$/, "").toUpperCase()} placeholder="0" value={prescribedValues[key]}
      onChange={(event) => setPrescribedValues({ ...prescribedValues, [key]: event.target.value })}
      onBlur={bevestigOpgelegd} onKeyDown={bevestigMetEnter} />
  );
  const lastVeld = (axis: LoadAxis) => (
    <input key={axis} ref={axis === "fx" ? firstForce : axis === "mx" ? firstMoment : undefined}
      className="fem-prop-input open-fem3d-nc-input" inputMode="decimal" required
      aria-label={axis.toUpperCase()} value={values[axis]}
      onChange={(event) => setValues({ ...values, [axis]: event.target.value })} />
  );

  return (
    <div className="open-fem3d-conditions">
      <section className="fem-prop-section">
        <div className="fem-prop-section-title">{t("openFem3d.support")}</div>
        <div className="open-fem3d-nc-presets" role="group" aria-label={t("openFem3d.support")}>
          {PRESETS.slice(0, 2).map(({ preset, key }) => (
            <button key={preset} type="button" aria-pressed={actievePreset === preset}
              className={actievePreset === preset ? "active" : undefined}
              onClick={() => usePreset(preset)}>{t(key)}</button>
          ))}
          <button type="button" aria-pressed={!support} className={!support ? "active" : undefined}
            onClick={clearSupport}>{t("openFem3d.free")}</button>
          {PRESETS.slice(2).map(({ preset, key }) => (
            <button key={preset} type="button" aria-pressed={actievePreset === preset}
              className={actievePreset === preset ? "active" : undefined}
              onClick={() => usePreset(preset)}>{t(key)}</button>
          ))}
        </div>
        <div className="open-fem3d-nc-grid open-fem3d-nc-dofs">
          {assenKop}
          <span className="open-fem3d-nc-label">{t("openFem3d.conditionTranslation")}</span>
          {(["ux", "uy", "uz"] as const).map(richting)}
          <span className="open-fem3d-nc-label">{t("openFem3d.conditionRotation")}</span>
          {(["rx", "ry", "rz"] as const).map(richting)}
        </div>

        <div className="open-fem3d-nc-subtitle">{t("openFem3d.springsTitle")} <span>· {t("openFem3d.globalAxes")}</span></div>
        <div className="open-fem3d-nc-grid">
          {assenKop}
          <span className="open-fem3d-nc-label">k <small>kN/mm</small></span>
          {(["kx", "ky", "kz"] as const).map(veerVeld)}
          <span className="open-fem3d-nc-label">c <small>kNm/rad</small></span>
          {(["krx", "kry", "krz"] as const).map(veerVeld)}
        </div>

        <div className="open-fem3d-nc-subtitle">{t("openFem3d.prescribedTitle")} <span>· {t("openFem3d.globalAxes")}</span></div>
        <div className="open-fem3d-nc-grid">
          {assenKop}
          <span className="open-fem3d-nc-label">u <small>mm</small></span>
          {(["uxM", "uyM", "uzM"] as const).map(opgelegdVeld)}
          <span className="open-fem3d-nc-label">φ <small>mrad</small></span>
          {(["rxRad", "ryRad", "rzRad"] as const).map(opgelegdVeld)}
        </div>
        {supportError && <p className="open-fem3d-error" role="alert">{supportError}</p>}
      </section>

      <section className="fem-prop-section">
        <div className="fem-prop-section-title">{t("openFem3d.nodalLoad")}</div>
        {nodeLoads.length > 0 && <div className="open-fem3d-condition-load-list">
          {nodeLoads.map((load) => (
            <div key={load.id} className={editingId === load.id ? "selected" : ""}>
              <button type="button" onClick={() => selectLoad(load)}>
                <strong>#{load.id}</strong> {describeLoad(load, i18n.language)}
              </button>
              <button type="button" onClick={() => deleteLoad(load.id)}
                aria-label={`${t("openFem3d.deleteLoad")} ${load.id}`}>×</button>
            </div>
          ))}
        </div>}
        <form onSubmit={saveLoad}>
          <div className="open-fem3d-nc-grid">
            {assenKop}
            <span className="open-fem3d-nc-label">F <small>{t("openFem3d.forceUnit")}</small></span>
            {FORCE_AXES.map(lastVeld)}
            <span className="open-fem3d-nc-label">M <small>{t("openFem3d.momentUnit")}</small></span>
            {MOMENT_AXES.map(lastVeld)}
          </div>
          <div className="open-fem3d-nc-actions">
            {editingId !== null && (
              <button className="open-fem3d-nc-secondary" type="button" onClick={newLoad}>+ {t("openFem3d.addLoad")}</button>
            )}
            <button className="open-fem3d-nc-primary" type="submit">
              {t(editingId === null ? "openFem3d.addLoad" : "openFem3d.saveLoad")}
            </button>
          </div>
        </form>
        {loadError && <p className="open-fem3d-error" role="alert">{loadError}</p>}
      </section>
    </div>
  );
}
