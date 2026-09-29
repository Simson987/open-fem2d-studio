import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addFrame3DMemberLoad,
  addFrame3DMemberPointLoad,
  addFrame3DThermalLoad,
  removeFrame3DMemberLoad,
  removeFrame3DMemberPointLoad,
  removeFrame3DThermalLoad,
  updateFrame3DMemberLoad,
  updateFrame3DMemberPointLoad,
  updateFrame3DThermalLoad,
  type Frame3DMemberLoad,
  type Frame3DMemberPointLoad,
  type Frame3DThermalLoad,
  type Frame3DModel,
} from "./frame3dModel";
import "./Frame3DNodeConditions.css";

interface Props {
  model: Frame3DModel;
  beamId: number;
  lengthM: number;
  onChange: (model: Frame3DModel) => void;
  editorRequest?: number;
  pointEditorRequest?: number;
  thermalEditorRequest?: number;
  activeLoadCaseId?: number;
  selectedLoad?: { kind: "memberLoad" | "memberPointLoad" | "thermalLoad"; id: number };
}

type Values = Record<"qyStart" | "qyEnd" | "qzStart" | "qzEnd" | "startPositionM" | "endPositionM", string>;
type PointValues = Record<"py" | "pz" | "positionM", string>;
type ThermalValues = Record<"deltaTUniformK" | "deltaTGradientYK" | "deltaTGradientZK", string>;

function emptyValues(lengthM: number): Values {
  return { qyStart: "0", qyEnd: "0", qzStart: "-5", qzEnd: "-5", startPositionM: "0", endPositionM: String(lengthM) };
}

function loadValues(load: Frame3DMemberLoad): Values {
  return Object.fromEntries(Object.keys(emptyValues(0)).map((key) => [key, String(load[key as keyof Values])])) as Values;
}

function describe(load: Frame3DMemberLoad): string {
  const y = load.qyStart || load.qyEnd ? `qy ${load.qyStart}→${load.qyEnd}` : "";
  const z = load.qzStart || load.qzEnd ? `qz ${load.qzStart}→${load.qzEnd}` : "";
  return [y, z, `${load.startPositionM}–${load.endPositionM} m`].filter(Boolean).join(" · ");
}

export default function Frame3DMemberLoads({
  model, beamId, lengthM, onChange, editorRequest, pointEditorRequest, thermalEditorRequest, activeLoadCaseId = 1,
  selectedLoad,
}: Props) {
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
  const [pointValues, setPointValues] = useState<PointValues>({ py: "0", pz: "-10", positionM: String(lengthM / 2) });
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
    setPointValues({ py: "0", pz: "-10", positionM: String(lengthM / 2) });
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
    setPointValues({ py: "0", pz: "-10", positionM: String(lengthM / 2) });
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

  const select = (load: Frame3DMemberLoad) => {
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
    const parsed = Object.fromEntries(Object.entries(submitted).map(([key, value]) => [key, Number(value)])) as
      unknown as Omit<Frame3DMemberLoad, "id" | "beamId" | "caseId">;
    try {
      const updated = editingId === null
        ? addFrame3DMemberLoad(model, beamId, parsed, activeLoadCaseId)
        : updateFrame3DMemberLoad(model, editingId, parsed);
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
    onChange(removeFrame3DMemberLoad(model, id));
    if (editingId === id) beginNew();
  };

  const selectPoint = (load: Frame3DMemberPointLoad) => {
    setActiveEditor("point");
    setPointEditingId(load.id);
    setPointValues({ py: String(load.py), pz: String(load.pz), positionM: String(load.positionM) });
    setError("");
  };

  const savePoint = (event: FormEvent) => {
    event.preventDefault();
    const parsed = Object.fromEntries(Object.entries(pointValues).map(([key, value]) => [key, Number(value)])) as
      unknown as Omit<Frame3DMemberPointLoad, "id" | "beamId" | "caseId">;
    try {
      const updated = pointEditingId === null
        ? addFrame3DMemberPointLoad(model, beamId, parsed, activeLoadCaseId)
        : updateFrame3DMemberPointLoad(model, pointEditingId, parsed);
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
    onChange(removeFrame3DMemberPointLoad(model, id));
    if (pointEditingId === id) beginNewPoint();
  };

  const selectThermal = (load: Frame3DThermalLoad) => {
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
      unknown as Omit<Frame3DThermalLoad, "id" | "beamId" | "caseId">;
    try {
      const updated = thermalEditingId === null
        ? addFrame3DThermalLoad(model, beamId, parsed, activeLoadCaseId)
        : updateFrame3DThermalLoad(model, thermalEditingId, parsed);
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
    onChange(removeFrame3DThermalLoad(model, id));
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

  const field = (name: keyof Values, label: string, ref = false) => <label><span>{label}</span>
    <input ref={ref ? firstInput : undefined} name={name} type="number" step="any" required value={values[name]}
      onChange={(event) => setValues({ ...values, [name]: event.target.value })} />
  </label>;

  return <div className="frame3d-conditions frame3d-member-loads">
    <div className="frame3d-load-tabs" role="tablist" aria-label="Belasting op staaf">
      <button type="button" role="tab" aria-selected={activeEditor === "line"} onClick={() => setActiveEditor("line")}>Lijnlast</button>
      <button type="button" role="tab" aria-selected={activeEditor === "point"} onClick={() => setActiveEditor("point")}>Puntlast</button>
      <button type="button" role="tab" aria-selected={activeEditor === "thermal"} onClick={() => setActiveEditor("thermal")}>Temperatuur</button>
    </div>
    {activeEditor === "line" && <section>
      <h3>Lijnlast op staaf</h3>
      <p className="fem-prop-hint">Lokale richting · kN/m · staaflengte {lengthM.toFixed(2)} m</p>
      {loads.length > 0 && <div className="frame3d-condition-load-list">
        {loads.map((load) => <div key={load.id} className={editingId === load.id ? "selected" : ""}>
          <button type="button" onClick={() => select(load)}><strong>#{load.id}</strong> {describe(load)}</button>
          <button type="button" onClick={() => remove(load.id)} aria-label={`Verwijder staafbelasting ${load.id}`}>×</button>
        </div>)}
      </div>}
      <button className="frame3d-condition-new" type="button" onClick={beginNew}>+ Nieuwe lijnlast</button>
      <form onSubmit={save}>
        <div className="frame3d-load-quick">
          <label><span>Richting</span><select value={lineDirection} onChange={(event) => {
            const direction = event.target.value as "y" | "z";
            const q = values[`q${lineDirection}Start`];
            setLineDirection(direction);
            setValues({ ...values,
              qyStart: direction === "y" ? q : "0", qyEnd: direction === "y" ? q : "0",
              qzStart: direction === "z" ? q : "0", qzEnd: direction === "z" ? q : "0" });
          }}><option value="z">Lokaal z</option><option value="y">Lokaal y</option></select></label>
          <label><span>q (kN/m)</span><input ref={firstInput} name="uniformQ" type="number" step="any" required
            value={values[`q${lineDirection}Start`]}
            onChange={(event) => setValues({ ...values,
              [`q${lineDirection}Start`]: event.target.value,
              [`q${lineDirection}End`]: event.target.value,
            })} /></label>
        </div>
        <button className="frame3d-load-more" type="button" aria-expanded={showLineDetails}
          onClick={() => setShowLineDetails((open) => !open)}>
          {showLineDetails ? "▾ Minder opties" : "▸ Variabele of gedeeltelijke lijnlast"}
        </button>
        {showLineDetails && <div className="frame3d-load-details">
          <fieldset>
            <legend>Intensiteit begin / eind (kN/m)</legend>
            <div className="frame3d-condition-values frame3d-member-load-values">
              {field("qyStart", "qy begin")}{field("qyEnd", "qy eind")}
              {field("qzStart", "qz begin")}{field("qzEnd", "qz eind")}
            </div>
          </fieldset>
          <fieldset>
            <legend>Belast bereik vanaf staafbegin (m)</legend>
            <div className="frame3d-condition-values frame3d-member-load-values">
              {field("startPositionM", "Begin")}{field("endPositionM", "Eind")}
            </div>
          </fieldset>
        </div>}
        <button className="frame3d-load-submit" type="submit">{editingId === null ? "Lijnlast toevoegen" : "Lijnlast opslaan"}</button>
      </form>
      {error && <p className="frame3d-error" role="alert">{error}</p>}
    </section>}
    {activeEditor === "point" && <section>
      <h3>Puntlast op staaf · lokale assen</h3>
      <p className="fem-prop-hint">Py en Pz in kN; positie gemeten vanaf het staafbegin.</p>
      {pointLoads.length > 0 && <div className="frame3d-condition-load-list">
        {pointLoads.map((load) => <div key={load.id} className={pointEditingId === load.id ? "selected" : ""}>
          <button type="button" onClick={() => selectPoint(load)}>
            <strong>P#{load.id}</strong> Py {load.py} · Pz {load.pz} · x {load.positionM} m
          </button>
          <button type="button" onClick={() => removePoint(load.id)} aria-label={`Verwijder staafpuntlast ${load.id}`}>×</button>
        </div>)}
      </div>}
      <button className="frame3d-condition-new" type="button" onClick={beginNewPoint}>Nieuwe staafpuntlast</button>
      <form onSubmit={savePoint}>
        <fieldset>
          <legend>Kracht en positie</legend>
          <div className="frame3d-condition-values frame3d-member-load-values">
            <label><span>Py (kN)</span><input ref={firstPointInput} type="number" step="any" required value={pointValues.py}
              onChange={(event) => setPointValues({ ...pointValues, py: event.target.value })} /></label>
            <label><span>Pz (kN)</span><input type="number" step="any" required value={pointValues.pz}
              onChange={(event) => setPointValues({ ...pointValues, pz: event.target.value })} /></label>
            <label><span>Positie (m)</span><input type="number" min="0" max={lengthM} step="any" required value={pointValues.positionM}
              onChange={(event) => setPointValues({ ...pointValues, positionM: event.target.value })} /></label>
          </div>
        </fieldset>
        <button type="submit">{pointEditingId === null ? "Toevoegen" : "Opslaan"}</button>
      </form>
      {error && <p className="frame3d-error" role="alert">{error}</p>}
    </section>}
    {activeEditor === "thermal" && <section>
      <h3>Temperatuurbelasting</h3>
      <p className="fem-prop-hint">Uniforme ΔT en verschillen over de lokale y/z-richting, alle in K.</p>
      {thermalLoads.length > 0 && <div className="frame3d-condition-load-list">
        {thermalLoads.map((load) => <div key={load.id} className={thermalEditingId === load.id ? "selected" : ""}>
          <button type="button" onClick={() => selectThermal(load)}>
            <strong>ΔT#{load.id}</strong> {load.deltaTUniformK} K · ΔTy {load.deltaTGradientYK} · ΔTz {load.deltaTGradientZK}
          </button>
          <button type="button" onClick={() => removeThermal(load.id)} aria-label={`Verwijder temperatuurbelasting ${load.id}`}>×</button>
        </div>)}
      </div>}
      <button className="frame3d-condition-new" type="button" onClick={beginNewThermal}>Nieuwe temperatuurbelasting</button>
      <form onSubmit={saveThermal}>
        <fieldset>
          <legend>Temperatuurverschillen (K)</legend>
          <div className="frame3d-condition-values frame3d-member-load-values">
            <label><span>ΔT uniform</span><input ref={firstThermalInput} type="number" step="any" required
              value={thermalValues.deltaTUniformK}
              onChange={(event) => setThermalValues({ ...thermalValues, deltaTUniformK: event.target.value })} /></label>
            <label><span>ΔT lokaal y</span><input type="number" step="any" required
              value={thermalValues.deltaTGradientYK}
              onChange={(event) => setThermalValues({ ...thermalValues, deltaTGradientYK: event.target.value })} /></label>
            <label><span>ΔT lokaal z</span><input type="number" step="any" required
              value={thermalValues.deltaTGradientZK}
              onChange={(event) => setThermalValues({ ...thermalValues, deltaTGradientZK: event.target.value })} /></label>
          </div>
        </fieldset>
        <button type="submit">{thermalEditingId === null ? "Toevoegen" : "Opslaan"}</button>
      </form>
      {error && <p className="frame3d-error" role="alert">{error}</p>}
    </section>}
  </div>;
}
