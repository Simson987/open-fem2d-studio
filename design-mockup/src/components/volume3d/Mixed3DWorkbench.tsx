import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import { metCode } from "./metCode";
import mixedExample from "../../../../src-tauri/crates/native-fem/examples/mixed3d-hex8-tet4-truss.json";
import distributedExample from "../../../../src-tauri/crates/native-fem/examples/mixed3d-distributed-loads.json";
import automaticExample from "../../../../src-tauri/crates/native-fem/examples/mixed3d-automatic-fallback.json";
import frameExample from "../../../../src-tauri/crates/native-fem/examples/mixed3d-tet4-frame-bending.json";
import matrixFreeFrameExample from "../../../../src-tauri/crates/native-fem/examples/mixed3d-tet4-hex8-frame-matrixfree-v1.json";
import membraneExample from "../../../../src-tauri/crates/native-fem/examples/mixed3d-tet4-membrane-coupling-v1.json";
import allTypesAnalyticExample from "../../../../src-tauri/crates/native-fem/examples/mixed3d-all-types-analytic.json";
import { solveNativeMixed3D, type NativeMixed3DInput, type NativeMixed3DResult } from "../../lib/nativeFemClient";
import { buildIrregularMixed3DModel, irregularCellRemoved, irregularGridPoint, LARGE_IRREGULAR_DIMENSIONS,
  MEDIUM_IRREGULAR_DIMENSIONS, SMALL_IRREGULAR_DIMENSIONS, type IrregularDimensions } from "./irregularMixed3dModel";

type Backend = NonNullable<NativeMixed3DInput["backend"]>;
const EXAMPLE = mixedExample as unknown as { kind: "mixed3d"; input: NativeMixed3DInput };
const DISTRIBUTED_EXAMPLE = distributedExample as unknown as { kind: "mixed3d"; input: NativeMixed3DInput };
const AUTOMATIC_EXAMPLE = automaticExample as unknown as { kind: "mixed3d"; input: NativeMixed3DInput };
const FRAME_EXAMPLE = frameExample as unknown as { kind: "mixed3d"; input: NativeMixed3DInput };
const MATRIX_FREE_FRAME_EXAMPLE = matrixFreeFrameExample as unknown as { kind: "mixed3d"; input: NativeMixed3DInput };
const MEMBRANE_EXAMPLE = membraneExample as unknown as { kind: "mixed3d"; input: NativeMixed3DInput };
const ALL_TYPES_ANALYTIC_EXAMPLE = allTypesAnalyticExample as unknown as { kind: "mixed3d"; input: NativeMixed3DInput };
// De labels staan in common.json onder mixed3dWorkbench.backend.*.
const BACKENDS: Backend[] = ["automatic", "dense", "sparseDirect", "sparsePcg", "matrixFreePcg", "frontalWave"];
/** Vertaling binnen mixed3dWorkbench; ook bruikbaar buiten een component (validatie). */
const m = (sleutel: string, waarden?: Record<string, unknown>) =>
  i18next.t(`mixed3dWorkbench.${sleutel}`, { ns: "common", ...waarden });
/** Getallen in de taal van de app (2.248 in het Nederlands, 2,248 in het Engels). */
const getal = (waarde: number) => waarde.toLocaleString(i18next.language || "nl");
const format = (value: number) => Number.isFinite(value) ? value.toExponential(4) : String(value);
const RESULT_ROWS = 24;

export function IrregularSection({ dims }: { dims: IrregularDimensions }) {
  useTranslation("common");
  const cell = 9;
  const section = Math.floor(5 * dims.nz / 12);
  const width = dims.nx * cell;
  const height = dims.ny * cell;
  return <figure style={{ margin: "12px 0" }}>
    <svg role="img" aria-label={m("sectionAria", { section })}
      viewBox={`-12 -12 ${width + 24} ${height + 24}`} style={{ width: "min(100%, 440px)", height: "auto", background: "#f8fafc", border: "1px solid #cbd5e1" }}>
      {Array.from({ length: dims.nx * dims.ny }, (_, n) => {
        const i = n % dims.nx;
        const j = Math.floor(n / dims.nx);
        if (irregularCellRemoved(dims, i, j, section)) return null;
        return <rect key={n} x={i * cell} y={(dims.ny - 1 - j) * cell} width={cell} height={cell}
          fill={i < dims.nx / 2 ? (j < dims.ny / 2 ? "#8ab4e2" : "#5d93ce")
            : (section < dims.nz / 2 ? "#e7ae78" : "#cf854e")}
          stroke="#fff" strokeWidth="0.25" />;
      })}
      <line x1={width / 2} y1="0" x2={width / 2} y2={height} stroke="#334155" strokeWidth="1.2" strokeDasharray="3 2" />
    </svg>
    <figcaption>{m("sectionCaption", { section, nz: dims.nz })}</figcaption>
  </figure>;
}

type PreviewFace = { key: string; family: "hex8" | "tet4"; side: "top" | "east" | "south";
  depth: number; corners: Array<[number, number, number]> };

/** Exposed cell faces through a horizontal cut; no interior mesh faces enter the SVG. */
export function buildIrregularCutawayFaces(dims: IrregularDimensions): PreviewFace[] {
  const cut = Math.floor(5 * dims.nz / 12) + 1;
  const occupied = (i: number, j: number, k: number) => i >= 0 && i < dims.nx && j >= 0 && j < dims.ny
    && k >= 0 && k < cut && !irregularCellRemoved(dims, i, j, k);
  const faces: PreviewFace[] = [];
  const add = (i: number, j: number, k: number, side: PreviewFace["side"], corners: PreviewFace["corners"]) => {
    const depth = corners.reduce((sum, [x, y, z]) => sum + x - y + z, 0) / 4;
    faces.push({ key: `${i}-${j}-${k}-${side}`, family: i < dims.nx / 2 ? "hex8" : "tet4", side, depth, corners });
  };
  for (let k = 0; k < cut; k++) for (let j = 0; j < dims.ny; j++) for (let i = 0; i < dims.nx; i++) {
    if (!occupied(i, j, k)) continue;
    if (!occupied(i, j, k + 1)) add(i, j, k, "top", [
      [i, j, k + 1], [i + 1, j, k + 1], [i + 1, j + 1, k + 1], [i, j + 1, k + 1],
    ]);
    if (!occupied(i + 1, j, k)) add(i, j, k, "east", [
      [i + 1, j, k], [i + 1, j + 1, k], [i + 1, j + 1, k + 1], [i + 1, j, k + 1],
    ]);
    if (!occupied(i, j - 1, k)) add(i, j, k, "south", [
      [i, j, k], [i + 1, j, k], [i + 1, j, k + 1], [i, j, k + 1],
    ]);
  }
  // Draw distant faces first. A stable key resolves ties between coplanar faces.
  return faces.sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
}

export function IrregularCutaway({ dims, model }: { dims: IrregularDimensions; model: NativeMixed3DInput }) {
  useTranslation("common");
  const faces = useMemo(() => buildIrregularCutawayFaces(dims), [dims]);
  const cut = Math.floor(5 * dims.nz / 12) + 1;
  const unit = 400 / (dims.nx + dims.ny);
  const project = ([x, y, z]: [number, number, number]): [number, number] => [
    16 + unit * (dims.ny + dims.nx * x - dims.ny * y),
    16 + unit * (0.9 * cut + 0.5 * (dims.nx * x + dims.ny * y) - 0.9 * dims.nz * z),
  ];
  const point = (i: number, j: number, k: number) => project(irregularGridPoint(dims, i, j, k));
  const truss = model.trusses[0].nodes.map((node) => project(model.mesh.nodes[node]));
  const frame = model.frames?.[0].nodes.map((node) => project(model.mesh.nodes[node])) ?? [];
  const colors = {
    hex8: { top: "#8ab4e2", east: "#3d75ad", south: "#6b9fd2" },
    tet4: { top: "#e7ae78", east: "#ae6436", south: "#d58d54" },
  };
  const height = 32 + unit * (0.9 * cut + 0.5 * (dims.nx + dims.ny));
  return <figure style={{ margin: "12px 0" }}>
    <svg role="img" aria-label={m("cutawayAria")}
      viewBox={`0 0 ${450 + 0.15 * dims.nx * unit} ${height}`} style={{ width: "min(100%, 640px)", height: "auto", background: "#f8fafc", border: "1px solid #cbd5e1" }}>
      {faces.map((face) => <polygon key={face.key} data-family={face.family} data-face={face.side}
        points={face.corners.map(([i, j, k]) => point(i, j, k).map((value) => value.toFixed(2)).join(",")).join(" ")}
        fill={colors[face.family][face.side]} stroke="#f8fafc" strokeWidth="0.25" />)}
      <line data-member="truss" x1={truss[0][0]} y1={truss[0][1]} x2={truss[1][0]} y2={truss[1][1]}
        stroke="#125b34" strokeWidth="3" strokeDasharray="4 2" />
      <line data-member="frame" x1={frame[0][0]} y1={frame[0][1]} x2={frame[1][0]} y2={frame[1][1]}
        stroke="#7933ad" strokeWidth="4" />
      <circle cx={frame[1][0]} cy={frame[1][1]} r="3" fill="#7933ad" />
    </svg>
    <figcaption>{m("cutawayCaption", { cut, nz: dims.nz })}</figcaption>
  </figure>;
}

function parseModel(json: string): NativeMixed3DInput {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") throw new Error(m("errors.modelObject"));
  const document = parsed as Record<string, unknown>;
  if (document.kind !== undefined && document.kind !== "mixed3d") {
    throw new Error(m("errors.kind"));
  }
  const model = (document.input ?? document) as Record<string, unknown>;
  const mesh = model.mesh as Record<string, unknown> | undefined;
  if (!mesh || !Array.isArray(mesh.nodes) || !Array.isArray(mesh.tets)
    || !model.solidMaterial || (model.hexes !== undefined && !Array.isArray(model.hexes))
    || (model.membranes !== undefined && !Array.isArray(model.membranes))
    || !Array.isArray(model.trusses) || (model.frames !== undefined && !Array.isArray(model.frames))
    || (model.momentsKnm !== undefined && !Array.isArray(model.momentsKnm))
    || (model.prescribedRotationsRad !== undefined && !Array.isArray(model.prescribedRotationsRad))
    || !Array.isArray(model.loadsKn) || !Array.isArray(model.prescribedM)) {
    throw new Error(m("errors.required"));
  }
  if (model.loadsKn.length !== mesh.nodes.length || model.prescribedM.length !== mesh.nodes.length) {
    throw new Error(m("errors.perNode"));
  }
  if ((Array.isArray(model.momentsKnm) && model.momentsKnm.length !== mesh.nodes.length)
    || (Array.isArray(model.prescribedRotationsRad) && model.prescribedRotationsRad.length !== mesh.nodes.length)) {
    throw new Error(m("errors.perNodeRotation"));
  }
  return model as unknown as NativeMixed3DInput;
}

export function Mixed3DResults({ model, result }: { model: NativeMixed3DInput; result: NativeMixed3DResult }) {
  const { t } = useTranslation("common");
  const maxDisplacement = result.nodalDisplacementsM.reduce((max, u) => Math.max(max, Math.hypot(...u)), 0);
  const maxTetStress = result.solidElementStressMpa.reduce((max, stress) => Math.max(max, ...stress.map(Math.abs)), 0);
  const maxHexStress = result.hexGaussStressMpa.reduce((max, points) =>
    Math.max(max, ...points.flatMap((stress) => stress.map(Math.abs))), 0);
  const limitedHexStresses = result.hexGaussStressMpa.slice(0, Math.ceil(RESULT_ROWS / 8))
    .flatMap((points, element) => points.map((stress, point) => ({ element, point, stress }))).slice(0, RESULT_ROWS);
  return <div aria-live="polite" style={{ marginTop: 16 }}>
    <h3>{m("resultHeading")}</h3>
    <p>{m("usedMethod")}: <strong>{result.backendUsed}</strong>
      {" · "}{t("volumeWorkbench.relativeResidual")}: <strong>{format(result.relativeResidual)}</strong>
      {" · "}{m("linearIterations")}: {result.linearIterations}
      {result.frontalMaximumFrontDofs !== null && ` · ${t("volumeWorkbench.peakFront", { dofs: result.frontalMaximumFrontDofs })}`}</p>
    <p>{m("summary", { nodes: getal(model.mesh.nodes.length), tets: getal(model.mesh.tets.length),
      hexes: getal(model.hexes?.length ?? 0), membranes: getal(model.membranes?.length ?? 0) })}
      {" · "}{m("extremes", { u: format(maxDisplacement), tet: format(maxTetStress), hex: format(maxHexStress) })}</p>
    <p>{m("rowsLimit", { rows: RESULT_ROWS })}</p>
    <h4>{t("volumeWorkbench.nodeTableHeading")}</h4>
    <div style={{ overflowX: "auto" }}><table>
      <thead><tr><th>{t("volumeWorkbench.node")}</th><th>uₓ</th><th>uᵧ</th><th>u𝓏</th><th>Rₓ</th><th>Rᵧ</th><th>R𝓏</th></tr></thead>
      <tbody>{result.nodalDisplacementsM.slice(0, RESULT_ROWS).map((u, node) => <tr key={node}>
        <td>{node}</td>{u.map((value, axis) => <td key={`u${axis}`}>{format(value)}</td>)}
        {result.nodalReactionsKn[node].map((value, axis) => <td key={`r${axis}`}>{format(value)}</td>)}
      </tr>)}</tbody>
    </table></div>
    {(result.nodalRotationsRad?.some((value) => value !== null) ?? false) && <>
      <h4>{m("rotationsHeading")}</h4>
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr><th>{t("volumeWorkbench.node")}</th><th>θₓ</th><th>θᵧ</th><th>θ𝓏</th><th>Mₓ</th><th>Mᵧ</th><th>M𝓏</th></tr></thead>
        <tbody>{result.nodalRotationsRad.flatMap((rotation, node) => rotation ? [{ rotation, node }] : []).slice(0, RESULT_ROWS).map(({ rotation, node }) => <tr key={node}>
          <td>{node}</td>{rotation.map((value, axis) => <td key={`theta${axis}`}>{format(value)}</td>)}
          {result.nodalMomentReactionsKnm[node]?.map((value, axis) => <td key={`moment${axis}`}>{format(value)}</td>)}
        </tr>)}</tbody>
      </table></div>
    </>}
    <h4>{m("tet4Stresses")}</h4>
    <div style={{ overflowX: "auto" }}><table>
      <thead><tr><th>{t("volumeWorkbench.element")}</th><th>σₓₓ</th><th>σᵧᵧ</th><th>σ𝓏𝓏</th><th>τₓᵧ</th><th>τᵧ𝓏</th><th>τ𝓏ₓ</th></tr></thead>
      <tbody>{result.solidElementStressMpa.slice(0, RESULT_ROWS).map((stress, element) => <tr key={element}>
        <td>{element}</td>{stress.map((value, component) => <td key={component}>{format(value)}</td>)}
      </tr>)}</tbody>
    </table></div>
    <h4>{m("hex8Stresses")}</h4>
    <div style={{ overflowX: "auto" }}><table>
      <thead><tr><th>{t("volumeWorkbench.element")}</th><th>{t("volumeWorkbench.gauss")}</th><th>σₓₓ</th><th>σᵧᵧ</th><th>σ𝓏𝓏</th><th>τₓᵧ</th><th>τᵧ𝓏</th><th>τ𝓏ₓ</th></tr></thead>
      <tbody>{limitedHexStresses.map(({ element, point, stress }) => <tr key={`${element}-${point}`}>
        <td>{element}</td><td>{point + 1}</td>{stress.map((value, component) => <td key={component}>{format(value)}</td>)}
      </tr>)}</tbody>
    </table></div>
    {(result.membraneStressMpa?.length ?? 0) > 0 && <>
      <h4>{m("membraneHeading")}</h4>
      <p>{m("membraneAxes")}</p>
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr><th>{m("triangle")}</th><th>σ₁₁</th><th>σ₂₂</th><th>τ₁₂</th><th>N₁₁</th><th>N₂₂</th><th>N₁₂</th></tr></thead>
        <tbody>{result.membraneStressMpa?.slice(0, RESULT_ROWS).map((stress, element) => <tr key={element}>
          <td>{element}</td>{stress.map((value, component) => <td key={`stress-${component}`}>{format(value)}</td>)}
          {result.membraneResultantsKnPerM?.[element]?.map((value, component) => <td key={`force-${component}`}>{format(value)}</td>)}
        </tr>)}</tbody>
      </table></div>
    </>}
    <h4>{m("trussHeading")}</h4>
    <div style={{ overflowX: "auto" }}><table>
      <thead><tr><th>{m("member")}</th><th>{m("nodes")}</th><th>{m("nTension")}</th></tr></thead>
      <tbody>{result.trussAxialForceKn.map((force, element) => <tr key={element}>
        <td>{element}</td><td>{model.trusses[element].nodes.join("–")}</td><td>{format(force)}</td>
      </tr>)}</tbody>
    </table></div>
    {(result.frameEndForcesLocal?.length ?? 0) > 0 && <>
      <h4>{m("frameHeading")}</h4>
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr><th>{m("frameMember")}</th><th>{t("volumeWorkbench.node")}</th><th>Fₓ</th><th>Fᵧ</th><th>F𝓏</th><th>Mₓ</th><th>Mᵧ</th><th>M𝓏</th></tr></thead>
        <tbody>{result.frameEndForcesLocal.flatMap((ends, element) => ends.map((forces, end) => <tr key={`${element}-${end}`}>
          <td>{element}</td><td>{model.frames?.[element]?.nodes[end] ?? end}</td>
          {forces.map((value, component) => <td key={component}>{format(value)}</td>)}
        </tr>))}</tbody>
      </table></div>
    </>}
  </div>;
}

export default function Mixed3DWorkbench() {
  const { t } = useTranslation("common");
  const [json, setJson] = useState(() => JSON.stringify(EXAMPLE, null, 2));
  const [backend, setBackend] = useState<Backend>("dense");
  const [solved, setSolved] = useState<{ model: NativeMixed3DInput; result: NativeMixed3DResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<{ dims: IrregularDimensions; model: NativeMixed3DInput } | null>(null);
  const requestVersion = useRef(0);

  const clearResult = () => {
    requestVersion.current += 1;
    setSolved(null);
    setError(null);
    setBusy(false);
  };
  const solve = async () => {
    const version = ++requestVersion.current;
    setSolved(null);
    setError(null);
    setBusy(true);
    try {
      const model = { ...(generated?.model ?? parseModel(json)), backend: generated ? "matrixFreePcg" as const : backend };
      const result = await solveNativeMixed3D(model);
      if (version === requestVersion.current) setSolved({ model, result });
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  };
  const loadFile = async (file: File) => {
    const version = ++requestVersion.current;
    setSolved(null);
    setError(null);
    setBusy(true);
    try {
      const contents = await file.text();
      const model = parseModel(contents);
      if (version === requestVersion.current) {
        setJson(contents);
        setBackend(model.backend ?? "dense");
        setGenerated(null);
      }
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  };
  const loadIrregular = (dims: IrregularDimensions) => {
    clearResult();
    try {
      const model = buildIrregularMixed3DModel(dims);
      setGenerated({ dims, model });
      setBackend("matrixFreePcg");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return <div>
    <p>{metCode(m("intro"))}</p>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
      <label>{t("volumeWorkbench.solveMethod")}<br /><select aria-label={m("methodAria")} value={backend} disabled={generated !== null} onChange={(event) => {
        clearResult(); setBackend(event.target.value as Backend);
      }}>{BACKENDS.map((option) => <option key={option} value={option}>{m(`backend.${option}`)}</option>)}</select></label>
      <button type="button" onClick={() => { clearResult(); setGenerated(null); setJson(JSON.stringify(EXAMPLE, null, 2)); setBackend("dense"); }}>{m("loadMixed")}</button>
      <button type="button" onClick={() => { clearResult(); setGenerated(null); setJson(JSON.stringify(DISTRIBUTED_EXAMPLE, null, 2)); setBackend("matrixFreePcg"); }}>{m("loadDistributed")}</button>
      <button type="button" onClick={() => { clearResult(); setGenerated(null); setJson(JSON.stringify(AUTOMATIC_EXAMPLE, null, 2)); setBackend("automatic"); }}>{m("loadAutomatic")}</button>
      <button type="button" onClick={() => { clearResult(); setGenerated(null); setJson(JSON.stringify(FRAME_EXAMPLE, null, 2)); setBackend("dense"); }}>{m("loadFrame")}</button>
      <button type="button" onClick={() => { clearResult(); setGenerated(null); setJson(JSON.stringify(MATRIX_FREE_FRAME_EXAMPLE, null, 2)); setBackend("matrixFreePcg"); }}>{m("loadMatrixFreeFrame")}</button>
      <button type="button" onClick={() => { clearResult(); setGenerated(null); setJson(JSON.stringify(MEMBRANE_EXAMPLE, null, 2)); setBackend("matrixFreePcg"); }}>{m("loadMembrane")}</button>
      <button type="button" onClick={() => { clearResult(); setGenerated(null); setJson(JSON.stringify(ALL_TYPES_ANALYTIC_EXAMPLE, null, 2)); setBackend("automatic"); }}>{m("loadAllTypes")}</button>
      <button type="button" onClick={() => loadIrregular(SMALL_IRREGULAR_DIMENSIONS)}>{m("loadIrregularSmall")}</button>
      <button type="button" onClick={() => loadIrregular(MEDIUM_IRREGULAR_DIMENSIONS)}>{m("loadIrregularMedium")}</button>
      <button type="button" onClick={() => loadIrregular(LARGE_IRREGULAR_DIMENSIONS)}>{m("loadIrregularLarge")}</button>
      <label>{m("openFile")}<br /><input type="file" accept=".json,application/json" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void loadFile(file);
        event.currentTarget.value = "";
      }} /></label>
      <button type="button" onClick={solve} disabled={busy}>{busy ? t("volumeWorkbench.solving") : m("solve")}</button>
    </div>
    {generated ? <section aria-label={m("irregularHeading")}>
      <h3>{m("irregularHeading")}</h3>
      <p>{m("irregularSummary", { nodes: getal(generated.model.mesh.nodes.length),
        tets: getal(generated.model.mesh.tets.length), hexes: getal(generated.model.hexes?.length ?? 0) })}</p>
      <IrregularCutaway dims={generated.dims} model={generated.model} />
      <IrregularSection dims={generated.dims} />
      <p>{m("irregularNote", { solve: m("solve") })}</p>
      <button type="button" onClick={() => { clearResult(); setGenerated(null); }}>{m("backToJson")}</button>
    </section> : <>
      <label htmlFor="mixed3d-workbench-json">{m("jsonLabel")}</label>
      <textarea id="mixed3d-workbench-json" aria-label={m("jsonLabel")} spellCheck={false} value={json}
        onChange={(event) => { clearResult(); setJson(event.target.value); }} rows={20}
        style={{ display: "block", boxSizing: "border-box", width: "100%", fontFamily: "monospace", marginTop: 6 }} />
    </>}
    <p style={{ fontSize: "0.85em" }}>{metCode(m("override"))}</p>
    <p style={{ fontSize: "0.85em" }}>{m("automaticNote")}</p>
    <p style={{ fontSize: "0.85em" }}>{metCode(m("hex8FaceNote"))}</p>
    {error && <p role="alert" style={{ color: "var(--color-danger, #b33)" }}>{t("volumeWorkbench.solverError", { error })}</p>}
    {solved && <Mixed3DResults model={solved.model} result={solved.result} />}
  </div>;
}
