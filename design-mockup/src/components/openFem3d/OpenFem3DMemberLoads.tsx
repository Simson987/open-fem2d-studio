import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  addOpenFem3DMemberLoad,
  addOpenFem3DMemberPointLoad,
  addOpenFem3DThermalLoad,
  removeOpenFem3DMemberLoad,
  removeOpenFem3DMemberPointLoad,
  removeOpenFem3DThermalLoad,
  updateOpenFem3DMemberLoad,
  updateOpenFem3DMemberPointLoad,
  updateOpenFem3DThermalLoad,
  type OpenFem3DMemberLoad,
  type OpenFem3DMemberPointLoad,
  type OpenFem3DThermalLoad,
  type OpenFem3DModel,
} from "./openFem3dModel";
import { formatLength, parseLength, toonMm } from "../../lib/lengthInput";
import "./OpenFem3DNodeConditions.css";

interface Props {
  model: OpenFem3DModel;
  beamId: number;
  lengthM: number;
  onChange: (model: OpenFem3DModel) => void;
  editorRequest?: number;
  pointEditorRequest?: number;
  thermalEditorRequest?: number;
  activeLoadCaseId?: number;
  selectedLoad?: { kind: "memberLoad" | "memberPointLoad" | "thermalLoad"; id: number };
}

// Posities worden in mm getypt (issue #36); het 3D-model bewaart meters vanaf
// het staafbegin. De tekstvelden houden daarom mm-tekst vast.
type Values = Record<"qyStart" | "qyEnd" | "qzStart" | "qzEnd" | "startMm" | "endMm", string>;
type PointValues = Record<"py" | "pz" | "positionMm", string>;
type ThermalValues = Record<"deltaTUniformK" | "deltaTGradientYK" | "deltaTGradientZK", string>;

function emptyValues(lengthM: number): Values {
  return { qyStart: "0", qyEnd: "0", qzStart: "-5", qzEnd: "-5", startMm: "0", endMm: formatLength(lengthM, "m") };
}

function loadValues(load: OpenFem3DMemberLoad): Values {
  return {
    qyStart: String(load.qyStart), qyEnd: String(load.qyEnd), qzStart: String(load.qzStart), qzEnd: String(load.qzEnd),
    startMm: formatLength(load.startPositionM, "m"), endMm: formatLength(load.endPositionM, "m"),
  };
}

function emptyPointValues(lengthM: number): PointValues {
  return { py: "0", pz: "-10", positionMm: formatLength(lengthM / 2, "m") };
}

/**
 * mm-tekst naar meters. Ongewijzigde tekst geeft de opgeslagen waarde exact
 * terug: de staaflengte √50 m = 7,0710678118654755 m staat als
 * "7071.067811865475" in het veld, en die tekst door 1000 delen geeft
 * 7,071067811865475 m, net niet de oorspronkelijke lengte.
 */
function textToMeters(text: string, storedM: number): number {
  return text === formatLength(storedM, "m") ? storedM : parseLength(text, "m");
}

/**
 * Lijnlast uit de ingetypte tekst: begin en eind in mm naar meters. Null bij
 * een ongeldige of buiten de staaf vallende positie; dan verandert er niets.
 * `stored` is waarmee het formulier gevuld werd (de bewerkte last, of 0 tot de
 * staaflengte voor een nieuwe last).
 */
export function openFem3DMemberLoadFromText(
  values: Values, lengthM: number,
  stored: { startPositionM: number; endPositionM: number } = { startPositionM: 0, endPositionM: lengthM },
): Omit<OpenFem3DMemberLoad, "id" | "beamId" | "caseId"> | null {
  const startPositionM = textToMeters(values.startMm, stored.startPositionM);
  const endPositionM = textToMeters(values.endMm, stored.endPositionM);
  if (!(startPositionM >= 0 && endPositionM > startPositionM && endPositionM <= lengthM + 1e-9)) return null;
  return {
    qyStart: Number(values.qyStart), qyEnd: Number(values.qyEnd),
    qzStart: Number(values.qzStart), qzEnd: Number(values.qzEnd),
    startPositionM, endPositionM,
  };
}

/** Staafpuntlast uit de ingetypte tekst: positie in mm naar meters, of null. */
export function openFem3DMemberPointLoadFromText(
  values: PointValues, lengthM: number, storedPositionM = lengthM / 2,
): Omit<OpenFem3DMemberPointLoad, "id" | "beamId" | "caseId"> | null {
  const positionM = textToMeters(values.positionMm, storedPositionM);
  if (!(positionM >= 0 && positionM <= lengthM + 1e-9)) return null;
  return { py: Number(values.py), pz: Number(values.pz), positionM };
}

function describe(load: OpenFem3DMemberLoad): string {
  const y = load.qyStart || load.qyEnd ? `qy ${load.qyStart}→${load.qyEnd}` : "";
  const z = load.qzStart || load.qzEnd ? `qz ${load.qzStart}→${load.qzEnd}` : "";
  return [y, z, `${toonMm(load.startPositionM, "m")}–${toonMm(load.endPositionM, "m")} mm`].filter(Boolean).join(" · ");
}

export default function OpenFem3DMemberLoads({
  model, beamId, lengthM, onChange, editorRequest, pointEditorRequest, thermalEditorRequest, activeLoadCaseId = 1,
  selectedLoad,
}: Props) {
  const { t } = useTranslation("ribbon");
  const loads = (model.memberLoads ?? []).filter((load) =>
    load.beamId === beamId && (load.caseId ?? 1) === activeLoadCaseId);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [values, setValues] = useState<Values>(() => emptyValues(lengthM));
  const [activeEditor, setActiveEditor] = useState<"line" | "point" | "thermal">("line");
  const [lineDirection, setLineDirection] = useState<"y" | "z">("z");
  const [showLineDetails, setShowLineDetails] = useState(false);
  const [error, setError] = useState("");
  const firstInput = useRef<HTMLInputElement>(null);
  const pointLoads = (model.memberPointLoads ?? []).filter((load) =>
    load.beamId === beamId && (load.caseId ?? 1) === activeLoadCaseId);
  const [pointEditingId, setPointEditingId] = useState<number | null>(null);
  const [pointValues, setPointValues] = useState<PointValues>(() => emptyPointValues(lengthM));
  const firstPointInput = useRef<HTMLInputElement>(null);
  const thermalLoads = (model.thermalLoads ?? []).filter((load) =>
    load.beamId === beamId && (load.caseId ?? 1) === activeLoadCaseId);
  const [thermalEditingId, setThermalEditingId] = useState<number | null>(null);
  const [thermalValues, setThermalValues] = useState<ThermalValues>({
    deltaTUniformK: "20", deltaTGradientYK: "0", deltaTGradientZK: "0",
  });
  const firstThermalInput = useRef<HTMLInputElement>(null);

  const beginNew = () => {
    setActiveEditor("line");
    setEditingId(null);
    setValues(emptyValues(lengthM));
    setLineDirection("z");
    setShowLineDetails(false);
    setError("");
    requestAnimationFrame(() => firstInput.current?.focus());
  };
  const beginNewPoint = () => {
    setActiveEditor("point");
    setPointEditingId(null);
    setPointValues(emptyPointValues(lengthM));
    setError("");
    requestAnimationFrame(() => firstPointInput.current?.focus());
  };
  const beginNewThermal = () => {
    setActiveEditor("thermal");
    setThermalEditingId(null);
    setThermalValues({ deltaTUniformK: "20", deltaTGradientYK: "0", deltaTGradientZK: "0" });
    setError("");
    requestAnimationFrame(() => firstThermalInput.current?.focus());
  };

  useEffect(() => {
    setEditingId(null);
    setValues(emptyValues(lengthM));
    setPointEditingId(null);
    setPointValues(emptyPointValues(lengthM));
    setThermalEditingId(null);
    setThermalValues({ deltaTUniformK: "20", deltaTGradientYK: "0", deltaTGradientZK: "0" });
    setError("");
  }, [beamId, activeLoadCaseId]);
  const previousEditorRequest = useRef(editorRequest);
  const previousPointEditorRequest = useRef(pointEditorRequest);
  const previousThermalEditorRequest = useRef(thermalEditorRequest);
  useEffect(() => {
    if (editorRequest !== previousEditorRequest.current) beginNew();
    previousEditorRequest.current = editorRequest;
  }, [editorRequest]);
  useEffect(() => {
    if (pointEditorRequest !== previousPointEditorRequest.current) beginNewPoint();
    previousPointEditorRequest.current = pointEditorRequest;
  }, [pointEditorRequest]);
  useEffect(() => {
    if (thermalEditorRequest !== previousThermalEditorRequest.current) beginNewThermal();
    previousThermalEditorRequest.current = thermalEditorRequest;
  }, [thermalEditorRequest]);

  const select = (load: OpenFem3DMemberLoad) => {
    setActiveEditor("line");
    setEditingId(load.id);
    setValues(loadValues(load));
    setLineDirection(Math.abs(load.qyStart) + Math.abs(load.qyEnd) > Math.abs(load.qzStart) + Math.abs(load.qzEnd) ? "y" : "z");
    setShowLineDetails(load.qyStart !== load.qyEnd || load.qzStart !== load.qzEnd ||
      (load.qyStart !== 0 && load.qzStart !== 0) || load.startPositionM !== 0 || load.endPositionM !== lengthM);
    setError("");
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const submitted = { ...values };
    const fields = new FormData(event.currentTarget as HTMLFormElement);
    if (showLineDetails) {
      for (const key of Object.keys(submitted) as (keyof Values)[]) {
        const value = fields.get(key);
        if (typeof value === "string") submitted[key] = value;
      }
    } else {
      const q = fields.get("uniformQ");
      if (typeof q === "string") {
        submitted[`q${lineDirection}Start`] = q;
        submitted[`q${lineDirection}End`] = q;
      }
    }
    const editing = editingId === null ? undefined : (model.memberLoads ?? []).find((load) => load.id === editingId);
    const parsed = openFem3DMemberLoadFromText(submitted, lengthM, editing);
    if (!parsed) {
      setError(t("canvas.popover.invalidRange", { ns: "common", lengte: toonMm(lengthM, "m") }));
      return;
    }
    try {
      const updated = editingId === null
        ? addOpenFem3DMemberLoad(model, beamId, parsed, activeLoadCaseId)
        : updateOpenFem3DMemberLoad(model, editingId, parsed);
      onChange(updated);
      if (editingId === null) {
        const all = updated.memberLoads ?? [];
        setEditingId(all[all.length - 1]?.id ?? null);
      }
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const remove = (id: number) => {
    onChange(removeOpenFem3DMemberLoad(model, id));
    if (editingId === id) beginNew();
  };

  const selectPoint = (load: OpenFem3DMemberPointLoad) => {
    setActiveEditor("point");
    setPointEditingId(load.id);
    setPointValues({ py: String(load.py), pz: String(load.pz), positionMm: formatLength(load.positionM, "m") });
    setError("");
  };

  const savePoint = (event: FormEvent) => {
    event.preventDefault();
    const editing = pointEditingId === null ? undefined
      : (model.memberPointLoads ?? []).find((load) => load.id === pointEditingId);
    const parsed = openFem3DMemberPointLoadFromText(pointValues, lengthM, editing?.positionM);
    if (!parsed) {
      setError(t("canvas.popover.invalidPosition", { ns: "common", lengte: toonMm(lengthM, "m") }));
      return;
    }
    try {
      const updated = pointEditingId === null
        ? addOpenFem3DMemberPointLoad(model, beamId, parsed, activeLoadCaseId)
        : updateOpenFem3DMemberPointLoad(model, pointEditingId, parsed);
      onChange(updated);
      if (pointEditingId === null) {
        const all = updated.memberPointLoads ?? [];
        setPointEditingId(all[all.length - 1]?.id ?? null);
      }
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const removePoint = (id: number) => {
    onChange(removeOpenFem3DMemberPointLoad(model, id));
    if (pointEditingId === id) beginNewPoint();
  };

  const selectThermal = (load: OpenFem3DThermalLoad) => {
    setActiveEditor("thermal");
    setThermalEditingId(load.id);
    setThermalValues({
      deltaTUniformK: String(load.deltaTUniformK),
      deltaTGradientYK: String(load.deltaTGradientYK),
      deltaTGradientZK: String(load.deltaTGradientZK),
    });
    setError("");
  };

  const saveThermal = (event: FormEvent) => {
    event.preventDefault();
    const parsed = Object.fromEntries(Object.entries(thermalValues).map(([key, value]) => [key, Number(value)])) as
      unknown as Omit<OpenFem3DThermalLoad, "id" | "beamId" | "caseId">;
    try {
      const updated = thermalEditingId === null
        ? addOpenFem3DThermalLoad(model, beamId, parsed, activeLoadCaseId)
        : updateOpenFem3DThermalLoad(model, thermalEditingId, parsed);
      onChange(updated);
      if (thermalEditingId === null) {
        const all = updated.thermalLoads ?? [];
        setThermalEditingId(all[all.length - 1]?.id ?? null);
      }
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const removeThermal = (id: number) => {
    onChange(removeOpenFem3DThermalLoad(model, id));
    if (thermalEditingId === id) beginNewThermal();
  };

  useEffect(() => {
    if (!selectedLoad) return;
    if (selectedLoad.kind === "memberLoad") {
      const load = loads.find((item) => item.id === selectedLoad.id);
      if (load) select(load);
    } else if (selectedLoad.kind === "memberPointLoad") {
      const load = pointLoads.find((item) => item.id === selectedLoad.id);
      if (load) selectPoint(load);
    } else {
      const load = thermalLoads.find((item) => item.id === selectedLoad.id);
      if (load) selectThermal(load);
    }
  }, [selectedLoad?.kind, selectedLoad?.id, beamId, activeLoadCaseId]);

  // Positievelden zijn tekst met een decimaal toetsenbord, zodat 1500,5 mag.
  const field = (name: keyof Values, label: string, ref = false) => <label><span>{label}</span>
    {name === "startMm" || name === "endMm"
      ? <input ref={ref ? firstInput : undefined} name={name} type="text" inputMode="decimal" required value={values[name]}
        onChange={(event) => setValues({ ...values, [name]: event.target.value })} />
      : <input ref={ref ? firstInput : undefined} name={name} type="number" step="any" required value={values[name]}
        onChange={(event) => setValues({ ...values, [name]: event.target.value })} />}
  </label>;

  return <div className="open-fem3d-conditions open-fem3d-member-loads">
    <div className="open-fem3d-load-tabs" role="tablist" aria-label={t("openFem3d.memberLoads.tabsAria")}>
      <button type="button" role="tab" aria-selected={activeEditor === "line"} onClick={() => setActiveEditor("line")}>{t("openFem3d.memberLoads.tabLine")}</button>
      <button type="button" role="tab" aria-selected={activeEditor === "point"} onClick={() => setActiveEditor("point")}>{t("openFem3d.memberLoads.tabPoint")}</button>
      <button type="button" role="tab" aria-selected={activeEditor === "thermal"} onClick={() => setActiveEditor("thermal")}>{t("openFem3d.memberLoads.tabThermal")}</button>
    </div>
    {activeEditor === "line" && <section>
      <h3>{t("openFem3d.memberLoads.lineTitle")}</h3>
      <p className="fem-prop-hint">{t("openFem3d.memberLoads.lineHint", { length: toonMm(lengthM, "m") })}</p>
      {loads.length > 0 && <div className="open-fem3d-condition-load-list">
        {loads.map((load) => <div key={load.id} className={editingId === load.id ? "selected" : ""}>
          <button type="button" onClick={() => select(load)}><strong>#{load.id}</strong> {describe(load)}</button>
          <button type="button" onClick={() => remove(load.id)} aria-label={t("openFem3d.memberLoads.deleteLine", { id: load.id })}>×</button>
        </div>)}
      </div>}
      <button className="open-fem3d-condition-new" type="button" onClick={beginNew}>{t("openFem3d.memberLoads.newLine")}</button>
      <form onSubmit={save}>
        <div className="open-fem3d-load-quick">
          <label><span>{t("openFem3d.memberLoads.direction")}</span><select value={lineDirection} onChange={(event) => {
            const direction = event.target.value as "y" | "z";
            const q = values[`q${lineDirection}Start`];
            setLineDirection(direction);
            setValues({ ...values,
              qyStart: direction === "y" ? q : "0", qyEnd: direction === "y" ? q : "0",
              qzStart: direction === "z" ? q : "0", qzEnd: direction === "z" ? q : "0" });
          }}><option value="z">{t("openFem3d.memberLoads.localZ")}</option><option value="y">{t("openFem3d.memberLoads.localY")}</option></select></label>
          <label><span>q (kN/m)</span><input ref={firstInput} name="uniformQ" type="number" step="any" required
            value={values[`q${lineDirection}Start`]}
            onChange={(event) => setValues({ ...values,
              [`q${lineDirection}Start`]: event.target.value,
              [`q${lineDirection}End`]: event.target.value,
            })} /></label>
        </div>
        <button className="open-fem3d-load-more" type="button" aria-expanded={showLineDetails}
          onClick={() => setShowLineDetails((open) => !open)}>
          {showLineDetails ? t("openFem3d.memberLoads.fewerOptions") : t("openFem3d.memberLoads.moreOptions")}
        </button>
        {showLineDetails && <div className="open-fem3d-load-details">
          <fieldset>
            <legend>{t("openFem3d.memberLoads.intensity")}</legend>
            <div className="open-fem3d-condition-values open-fem3d-member-load-values">
              {field("qyStart", t("openFem3d.memberLoads.qyStart"))}{field("qyEnd", t("openFem3d.memberLoads.qyEnd"))}
              {field("qzStart", t("openFem3d.memberLoads.qzStart"))}{field("qzEnd", t("openFem3d.memberLoads.qzEnd"))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t("openFem3d.memberLoads.range")}</legend>
            <div className="open-fem3d-condition-values open-fem3d-member-load-values">
              {field("startMm", t("openFem3d.memberLoads.start"))}{field("endMm", t("openFem3d.memberLoads.end"))}
            </div>
          </fieldset>
        </div>}
        <button className="open-fem3d-load-submit" type="submit">{editingId === null ? t("openFem3d.memberLoads.addLine") : t("openFem3d.memberLoads.saveLine")}</button>
      </form>
      {error && <p className="open-fem3d-error" role="alert">{error}</p>}
    </section>}
    {activeEditor === "point" && <section>
      <h3>{t("openFem3d.memberLoads.pointTitle")}</h3>
      <p className="fem-prop-hint">{t("openFem3d.memberLoads.pointHint")}</p>
      {pointLoads.length > 0 && <div className="open-fem3d-condition-load-list">
        {pointLoads.map((load) => <div key={load.id} className={pointEditingId === load.id ? "selected" : ""}>
          <button type="button" onClick={() => selectPoint(load)}>
            <strong>P#{load.id}</strong> Py {load.py} · Pz {load.pz} · x {toonMm(load.positionM, "m")} mm
          </button>
          <button type="button" onClick={() => removePoint(load.id)} aria-label={t("openFem3d.memberLoads.deletePoint", { id: load.id })}>×</button>
        </div>)}
      </div>}
      <button className="open-fem3d-condition-new" type="button" onClick={beginNewPoint}>{t("openFem3d.memberLoads.newPoint")}</button>
      <form onSubmit={savePoint}>
        <fieldset>
          <legend>{t("openFem3d.memberLoads.forceAndPosition")}</legend>
          <div className="open-fem3d-condition-values open-fem3d-member-load-values">
            <label><span>Py (kN)</span><input ref={firstPointInput} type="number" step="any" required value={pointValues.py}
              onChange={(event) => setPointValues({ ...pointValues, py: event.target.value })} /></label>
            <label><span>Pz (kN)</span><input type="number" step="any" required value={pointValues.pz}
              onChange={(event) => setPointValues({ ...pointValues, pz: event.target.value })} /></label>
            <label><span>{t("openFem3d.memberLoads.positionMm")}</span><input type="text" inputMode="decimal" required value={pointValues.positionMm}
              onChange={(event) => setPointValues({ ...pointValues, positionMm: event.target.value })} /></label>
          </div>
        </fieldset>
        <button type="submit">{pointEditingId === null ? t("openFem3d.memberLoads.add") : t("save", { ns: "common" })}</button>
      </form>
      {error && <p className="open-fem3d-error" role="alert">{error}</p>}
    </section>}
    {activeEditor === "thermal" && <section>
      <h3>{t("openFem3d.memberLoads.thermalTitle")}</h3>
      <p className="fem-prop-hint">{t("openFem3d.memberLoads.thermalHint")}</p>
      {thermalLoads.length > 0 && <div className="open-fem3d-condition-load-list">
        {thermalLoads.map((load) => <div key={load.id} className={thermalEditingId === load.id ? "selected" : ""}>
          <button type="button" onClick={() => selectThermal(load)}>
            <strong>ΔT#{load.id}</strong> {load.deltaTUniformK} K · ΔTy {load.deltaTGradientYK} · ΔTz {load.deltaTGradientZK}
          </button>
          <button type="button" onClick={() => removeThermal(load.id)} aria-label={t("openFem3d.memberLoads.deleteThermal", { id: load.id })}>×</button>
        </div>)}
      </div>}
      <button className="open-fem3d-condition-new" type="button" onClick={beginNewThermal}>{t("openFem3d.memberLoads.newThermal")}</button>
      <form onSubmit={saveThermal}>
        <fieldset>
          <legend>{t("openFem3d.memberLoads.thermalLegend")}</legend>
          <div className="open-fem3d-condition-values open-fem3d-member-load-values">
            <label><span>{t("openFem3d.memberLoads.deltaTUniform")}</span><input ref={firstThermalInput} type="number" step="any" required
              value={thermalValues.deltaTUniformK}
              onChange={(event) => setThermalValues({ ...thermalValues, deltaTUniformK: event.target.value })} /></label>
            <label><span>{t("openFem3d.memberLoads.deltaTLocalY")}</span><input type="number" step="any" required
              value={thermalValues.deltaTGradientYK}
              onChange={(event) => setThermalValues({ ...thermalValues, deltaTGradientYK: event.target.value })} /></label>
            <label><span>{t("openFem3d.memberLoads.deltaTLocalZ")}</span><input type="number" step="any" required
              value={thermalValues.deltaTGradientZK}
              onChange={(event) => setThermalValues({ ...thermalValues, deltaTGradientZK: event.target.value })} /></label>
          </div>
        </fieldset>
        <button type="submit">{thermalEditingId === null ? t("openFem3d.memberLoads.add") : t("save", { ns: "common" })}</button>
      </form>
      {error && <p className="open-fem3d-error" role="alert">{error}</p>}
    </section>}
  </div>;
}
