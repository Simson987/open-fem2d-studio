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
  isOpenFem3DGlobalMemberLoad,
  type OpenFem3DGlobalDirection,
  type OpenFem3DMemberLoad,
  type OpenFem3DMemberLoadValues,
  type OpenFem3DMemberPointLoad,
  type OpenFem3DThermalLoad,
  type OpenFem3DModel,
} from "./openFem3dModel";
import { formatLength, parseLength, toonMm } from "../../lib/lengthInput";
import { OPEN_FEM_3D_DEFAULT_POINT_LOAD_KN } from "./openFem3dPlaatsen";
import "./OpenFem3DNodeConditions.css";
import "./OpenFem3DMemberLoads.css";

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
// qStart/qEnd zijn de waarden van een globale last (issue #80), qy/qz die van een lokale.
type Values = Record<"qyStart" | "qyEnd" | "qzStart" | "qzEnd" | "startMm" | "endMm", string> & Partial<Record<"qStart" | "qEnd", string>>;
type PointValues = Record<"py" | "pz" | "positionMm", string>;
type ThermalValues = Record<"deltaTUniformK" | "deltaTGradientYK" | "deltaTGradientZK", string>;

/** De keuze Richting: lokaal y of z, of een globale as X, Y of Z (issue #80). */
type LineDirection = "y" | "z" | "X" | "Y" | "Z";
const GLOBAL_LINE_DIRECTIONS = { X: "x", Y: "y", Z: "z" } as const satisfies Record<string, OpenFem3DGlobalDirection>;
const globalOf = (direction: LineDirection): OpenFem3DGlobalDirection | null =>
  direction === "X" || direction === "Y" || direction === "Z" ? GLOBAL_LINE_DIRECTIONS[direction] : null;
/** Het veld met de beginwaarde (en eindwaarde) van een richting. */
const startKey = (direction: LineDirection) => globalOf(direction) ? "qStart" as const : `q${direction as "y" | "z"}Start` as const;
const endKey = (direction: LineDirection) => globalOf(direction) ? "qEnd" as const : `q${direction as "y" | "z"}End` as const;

function emptyValues(lengthM: number): Values {
  return {
    qyStart: "0", qyEnd: "0", qzStart: "-5", qzEnd: "-5", qStart: "0", qEnd: "0",
    startMm: "0", endMm: formatLength(lengthM, "m"),
  };
}

function loadValues(load: OpenFem3DMemberLoad): Values {
  const range = { startMm: formatLength(load.startPositionM, "m"), endMm: formatLength(load.endPositionM, "m") };
  return isOpenFem3DGlobalMemberLoad(load)
    ? { qyStart: "0", qyEnd: "0", qzStart: "0", qzEnd: "0", qStart: String(load.qStart), qEnd: String(load.qEnd), ...range }
    : {
        qyStart: String(load.qyStart), qyEnd: String(load.qyEnd), qzStart: String(load.qzStart), qzEnd: String(load.qzEnd),
        qStart: "0", qEnd: "0", ...range,
      };
}

/** Een nieuwe staafpuntlast: dezelfde standaardwaarde als het gereedschap Puntlast (−10 kN), in het midden. */
function emptyPointValues(lengthM: number): PointValues {
  return { py: "0", pz: String(OPEN_FEM_3D_DEFAULT_POINT_LOAD_KN), positionMm: formatLength(lengthM / 2, "m") };
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
 * staaflengte voor een nieuwe last). Met `global` (issue #80) is het een
 * globale last uit qStart en qEnd, per staafmeter of per projectie.
 */
export function openFem3DMemberLoadFromText(
  values: Values, lengthM: number,
  stored: { startPositionM: number; endPositionM: number } = { startPositionM: 0, endPositionM: lengthM },
  global?: { direction: OpenFem3DGlobalDirection; perProjection: boolean },
): OpenFem3DMemberLoadValues | null {
  const startPositionM = textToMeters(values.startMm, stored.startPositionM);
  const endPositionM = textToMeters(values.endMm, stored.endPositionM);
  if (!(startPositionM >= 0 && endPositionM > startPositionM && endPositionM <= lengthM + 1e-9)) return null;
  if (global) {
    return {
      globalDirection: global.direction, qStart: Number(values.qStart ?? 0), qEnd: Number(values.qEnd ?? 0),
      perProjection: global.perProjection, startPositionM, endPositionM,
    };
  }
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

/**
 * De regel van een lijnlast in de lijst (en de verkenner): lokaal "qy …" en
 * "qz …", globaal (#80) "qZ …" met de as in hoofdletter en, per projectie, de
 * korte aanduiding `projection`.
 */
export function openFem3DMemberLoadSummary(load: OpenFem3DMemberLoad, projection: string): string {
  const range = `${toonMm(load.startPositionM, "m")}–${toonMm(load.endPositionM, "m")} mm`;
  if (isOpenFem3DGlobalMemberLoad(load)) {
    return [`q${load.globalDirection.toUpperCase()} ${load.qStart}→${load.qEnd}`, load.perProjection ? projection : "", range]
      .filter(Boolean).join(" · ");
  }
  const y = load.qyStart || load.qyEnd ? `qy ${load.qyStart}→${load.qyEnd}` : "";
  const z = load.qzStart || load.qzEnd ? `qz ${load.qzStart}→${load.qzEnd}` : "";
  return [y, z, range].filter(Boolean).join(" · ");
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
  // De korte aanduiding per projectie in de lijst; buiten de knop vertaald, zodat de API-dekking die knop als `select` blijft kennen.
  const projectionShort = t("openFem3d.memberLoads.perProjectionShort");
  const [lineDirection, setLineDirection] = useState<LineDirection>("z");
  const [perProjection, setPerProjection] = useState(false);
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
    setPerProjection(false);
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
    const partial = load.startPositionM !== 0 || load.endPositionM !== lengthM;
    if (isOpenFem3DGlobalMemberLoad(load)) {
      setLineDirection(load.globalDirection.toUpperCase() as LineDirection);
      setPerProjection(load.perProjection === true);
      setShowLineDetails(load.qStart !== load.qEnd || partial);
    } else {
      setLineDirection(Math.abs(load.qyStart) + Math.abs(load.qyEnd) > Math.abs(load.qzStart) + Math.abs(load.qzEnd) ? "y" : "z");
      setPerProjection(false);
      setShowLineDetails(load.qyStart !== load.qyEnd || load.qzStart !== load.qzEnd ||
        (load.qyStart !== 0 && load.qzStart !== 0) || partial);
    }
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
        submitted[startKey(lineDirection)] = q;
        submitted[endKey(lineDirection)] = q;
      }
    }
    const editing = editingId === null ? undefined : (model.memberLoads ?? []).find((load) => load.id === editingId);
    const direction = globalOf(lineDirection);
    const parsed = openFem3DMemberLoadFromText(submitted, lengthM, editing,
      direction ? { direction, perProjection } : undefined);
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
  // Elk veld is een rij van het eigenschappenpaneel: label links, veld rechts (issue #108).
  const field = (name: keyof Values, label: string, ref = false) => <label className="fem-prop-row">
    <span className="fem-prop-label">{label}</span>
    {name === "startMm" || name === "endMm"
      ? <input ref={ref ? firstInput : undefined} className="fem-prop-input" name={name} type="text" inputMode="decimal" required value={values[name]}
        onChange={(event) => setValues({ ...values, [name]: event.target.value })} />
      : <input ref={ref ? firstInput : undefined} className="fem-prop-input" name={name} type="number" step="any" required value={values[name] ?? "0"}
        onChange={(event) => setValues({ ...values, [name]: event.target.value })} />}
  </label>;

  // Opbouw als het knooppaneel (OpenFem3DNodeConditions): een sectie met de kop
  // als band, de keuze Lijnlast/Puntlast/Temperatuur als knoppenrij, velden als
  // .fem-prop-row met .fem-prop-input en de knoppen van dat paneel. Geen kale
  // h3/label/select/input/button: die vallen terug op de letter van de pagina of
  // van de browser (issue #108, test-open-fem3d-lastpaneel-ui.mjs).
  return <div className="open-fem3d-conditions open-fem3d-member-loads">
    <section className="fem-prop-section">
      <div className="fem-prop-section-title">{t("openFem3d.memberLoads.tabsAria")}</div>
      <div className="open-fem3d-load-tabs" role="tablist" aria-label={t("openFem3d.memberLoads.tabsAria")}>
        <button type="button" role="tab" aria-selected={activeEditor === "line"} onClick={() => setActiveEditor("line")}>{t("openFem3d.memberLoads.tabLine")}</button>
        <button type="button" role="tab" aria-selected={activeEditor === "point"} onClick={() => setActiveEditor("point")}>{t("openFem3d.memberLoads.tabPoint")}</button>
        <button type="button" role="tab" aria-selected={activeEditor === "thermal"} onClick={() => setActiveEditor("thermal")}>{t("openFem3d.memberLoads.tabThermal")}</button>
      </div>
      {activeEditor === "line" && <div className="open-fem3d-load-editor">
        <h3 className="open-fem3d-load-title">{t("openFem3d.memberLoads.lineTitle")}</h3>
        <p className="fem-prop-hint">{t("openFem3d.memberLoads.lineHint", { length: toonMm(lengthM, "m") })}</p>
        {loads.length > 0 && <div className="open-fem3d-condition-load-list">
          {loads.map((load) => <div key={load.id} className={editingId === load.id ? "selected" : ""}>
            <button type="button" onClick={() => select(load)}><strong>#{load.id}</strong> {openFem3DMemberLoadSummary(load, projectionShort)}</button>
            <button type="button" onClick={() => remove(load.id)} aria-label={t("openFem3d.memberLoads.deleteLine", { id: load.id })}>×</button>
          </div>)}
        </div>}
        <button className="open-fem3d-condition-new open-fem3d-nc-secondary" type="button" onClick={beginNew}>{t("openFem3d.memberLoads.newLine")}</button>
        <form onSubmit={save}>
          <div className="open-fem3d-load-quick">
            <label className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.memberLoads.direction")}</span><select className="fem-prop-input" data-open-fem3d-line-direction value={lineDirection} onChange={(event) => {
              // De ingevulde q gaat mee naar de nieuwe richting; de andere waarden worden 0.
              const direction = event.target.value as LineDirection;
              const q = values[startKey(lineDirection)] ?? "0";
              setLineDirection(direction);
              setValues({ ...values, qyStart: "0", qyEnd: "0", qzStart: "0", qzEnd: "0", qStart: "0", qEnd: "0",
                [startKey(direction)]: q, [endKey(direction)]: q });
            }}>
              <option value="z">{t("openFem3d.memberLoads.localZ")}</option><option value="y">{t("openFem3d.memberLoads.localY")}</option>
              <option value="X">{t("openFem3d.memberLoads.globalX")}</option><option value="Y">{t("openFem3d.memberLoads.globalY")}</option>
              <option value="Z">{t("openFem3d.memberLoads.globalZ")}</option>
            </select></label>
            <label className="fem-prop-row"><span className="fem-prop-label">q (kN/m)</span><input ref={firstInput} className="fem-prop-input" name="uniformQ" type="number" step="any" required
              value={values[startKey(lineDirection)] ?? "0"}
              onChange={(event) => setValues({ ...values,
                [startKey(lineDirection)]: event.target.value,
                [endKey(lineDirection)]: event.target.value,
              })} /></label>
          </div>
          {globalOf(lineDirection) && <>
            <label className="open-fem3d-check-row open-fem3d-load-projection">
              <input type="checkbox" className="fem-prop-checkbox" data-open-fem3d-per-projection checked={perProjection}
                onChange={(event) => setPerProjection(event.target.checked)} />
              <span>{t("openFem3d.memberLoads.perProjection")}</span>
            </label>
            <p className="fem-prop-hint" data-open-fem3d-per-projection-hint>{t("openFem3d.memberLoads.perProjectionHint")}</p>
          </>}
          <button className="open-fem3d-load-more" type="button" aria-expanded={showLineDetails}
            onClick={() => setShowLineDetails((open) => !open)}>
            {showLineDetails ? t("openFem3d.memberLoads.fewerOptions") : t("openFem3d.memberLoads.moreOptions")}
          </button>
          {showLineDetails && <div className="open-fem3d-load-details">
            <fieldset>
              <legend>{t("openFem3d.memberLoads.intensity")}</legend>
              {globalOf(lineDirection)
                ? <>{field("qStart", t("openFem3d.memberLoads.qStart"))}{field("qEnd", t("openFem3d.memberLoads.qEnd"))}</>
                : <>
                  {field("qyStart", t("openFem3d.memberLoads.qyStart"))}{field("qyEnd", t("openFem3d.memberLoads.qyEnd"))}
                  {field("qzStart", t("openFem3d.memberLoads.qzStart"))}{field("qzEnd", t("openFem3d.memberLoads.qzEnd"))}
                </>}
            </fieldset>
            <fieldset>
              <legend>{t("openFem3d.memberLoads.range")}</legend>
              {field("startMm", t("openFem3d.memberLoads.start"))}{field("endMm", t("openFem3d.memberLoads.end"))}
            </fieldset>
          </div>}
          <div className="open-fem3d-nc-actions">
            <button className="open-fem3d-load-submit open-fem3d-nc-primary" type="submit">{editingId === null ? t("openFem3d.memberLoads.addLine") : t("openFem3d.memberLoads.saveLine")}</button>
          </div>
        </form>
        {error && <p className="open-fem3d-error" role="alert">{error}</p>}
      </div>}
      {activeEditor === "point" && <div className="open-fem3d-load-editor">
        <h3 className="open-fem3d-load-title">{t("openFem3d.memberLoads.pointTitle")}</h3>
        <p className="fem-prop-hint">{t("openFem3d.memberLoads.pointHint")}</p>
        {pointLoads.length > 0 && <div className="open-fem3d-condition-load-list">
          {pointLoads.map((load) => <div key={load.id} className={pointEditingId === load.id ? "selected" : ""}>
            <button type="button" onClick={() => selectPoint(load)}>
              <strong>P#{load.id}</strong> Py {load.py} · Pz {load.pz} · x {toonMm(load.positionM, "m")} mm
            </button>
            <button type="button" onClick={() => removePoint(load.id)} aria-label={t("openFem3d.memberLoads.deletePoint", { id: load.id })}>×</button>
          </div>)}
        </div>}
        <button className="open-fem3d-condition-new open-fem3d-nc-secondary" type="button" onClick={beginNewPoint}>{t("openFem3d.memberLoads.newPoint")}</button>
        <form onSubmit={savePoint}>
          <fieldset>
            <legend>{t("openFem3d.memberLoads.forceAndPosition")}</legend>
            <label className="fem-prop-row"><span className="fem-prop-label">Py (kN)</span><input ref={firstPointInput} className="fem-prop-input" type="number" step="any" required value={pointValues.py}
              onChange={(event) => setPointValues({ ...pointValues, py: event.target.value })} /></label>
            <label className="fem-prop-row"><span className="fem-prop-label">Pz (kN)</span><input className="fem-prop-input" type="number" step="any" required value={pointValues.pz}
              onChange={(event) => setPointValues({ ...pointValues, pz: event.target.value })} /></label>
            <label className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.memberLoads.positionMm")}</span><input className="fem-prop-input" type="text" inputMode="decimal" required value={pointValues.positionMm}
              onChange={(event) => setPointValues({ ...pointValues, positionMm: event.target.value })} /></label>
          </fieldset>
          <div className="open-fem3d-nc-actions">
            <button className="open-fem3d-load-submit open-fem3d-nc-primary" type="submit">{pointEditingId === null ? t("openFem3d.memberLoads.add") : t("save", { ns: "common" })}</button>
          </div>
        </form>
        {error && <p className="open-fem3d-error" role="alert">{error}</p>}
      </div>}
      {activeEditor === "thermal" && <div className="open-fem3d-load-editor">
        <h3 className="open-fem3d-load-title">{t("openFem3d.memberLoads.thermalTitle")}</h3>
        <p className="fem-prop-hint">{t("openFem3d.memberLoads.thermalHint")}</p>
        {thermalLoads.length > 0 && <div className="open-fem3d-condition-load-list">
          {thermalLoads.map((load) => <div key={load.id} className={thermalEditingId === load.id ? "selected" : ""}>
            <button type="button" onClick={() => selectThermal(load)}>
              <strong>ΔT#{load.id}</strong> {load.deltaTUniformK} K · ΔTy {load.deltaTGradientYK} · ΔTz {load.deltaTGradientZK}
            </button>
            <button type="button" onClick={() => removeThermal(load.id)} aria-label={t("openFem3d.memberLoads.deleteThermal", { id: load.id })}>×</button>
          </div>)}
        </div>}
        <button className="open-fem3d-condition-new open-fem3d-nc-secondary" type="button" onClick={beginNewThermal}>{t("openFem3d.memberLoads.newThermal")}</button>
        <form onSubmit={saveThermal}>
          <fieldset>
            <legend>{t("openFem3d.memberLoads.thermalLegend")}</legend>
            <label className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.memberLoads.deltaTUniform")}</span><input ref={firstThermalInput} className="fem-prop-input" type="number" step="any" required
              value={thermalValues.deltaTUniformK}
              onChange={(event) => setThermalValues({ ...thermalValues, deltaTUniformK: event.target.value })} /></label>
            <label className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.memberLoads.deltaTLocalY")}</span><input className="fem-prop-input" type="number" step="any" required
              value={thermalValues.deltaTGradientYK}
              onChange={(event) => setThermalValues({ ...thermalValues, deltaTGradientYK: event.target.value })} /></label>
            <label className="fem-prop-row"><span className="fem-prop-label">{t("openFem3d.memberLoads.deltaTLocalZ")}</span><input className="fem-prop-input" type="number" step="any" required
              value={thermalValues.deltaTGradientZK}
              onChange={(event) => setThermalValues({ ...thermalValues, deltaTGradientZK: event.target.value })} /></label>
          </fieldset>
          <div className="open-fem3d-nc-actions">
            <button className="open-fem3d-load-submit open-fem3d-nc-primary" type="submit">{thermalEditingId === null ? t("openFem3d.memberLoads.add") : t("save", { ns: "common" })}</button>
          </div>
        </form>
        {error && <p className="open-fem3d-error" role="alert">{error}</p>}
      </div>}
    </section>
  </div>;
}
