/**
 * Browserkant van test-open-fem3d-symboolschaal-ui.mjs: de grootte van knopen
 * en opleggingen (issue #82) in het echte 3D-tekenvlak (ThreeFrameCanvas,
 * WebGL), het venster Zichtbaarheid en de verkenner, in een lokale headless
 * browser.
 *
 *  - Op het scherm gemeten (beeldpunten, parallelle projectie, vaste camera):
 *    de knoopbol en een opleggingsteken staan bij 200 % twee keer zo groot
 *    als bij 100 % (breedte en wortel van het oppervlak), bij 50 % half zo
 *    groot; ook een opleggingsteken in een GPU-batch. De camera verandert niet.
 *  - Elk teken wordt gemeten als het verschil tussen het beeld met en zonder
 *    dat teken (zelfde scène, zelfde camera); de kleur doet er niet toe.
 *  - Kiezen: een klik op een punt dat alleen bij 200 % op de knoopbol of het
 *    opleggingsteken ligt, kiest bij 200 % die knoop en bij 100 % niets; bij
 *    200 en 400 % kiest ook een klik op de halve straal en op 0,95 · r de knoop.
 *  - Snelle wegen: Knopen → "node-scale", Opleggingen → "support-scale", geen
 *    volledige opbouw; de lasten blijven beeldpunt voor beeldpunt gelijk; de
 *    scharnierbolletjes volgen de knoopbol; de staalhal van 60 × 30 m blijft
 *    sneller dan een volledige opbouw.
 *  - De volledige opbouw met een bewaarde knoopschaal tekent en kiest op de
 *    geschaalde bol; na een regelaar en daarna een volledige opbouw blijft een
 *    plaat onder een contour doorzichtig; bij randopleggingen vervangt de
 *    regelaar Opleggingen alleen die tekens, niet het net of de contour.
 *  - Het venster en de verkenner: de regelaar onder Knopen en onder
 *    Opleggingen, de waarde in %, schuiven, dubbelklik en de waardeknop zetten
 *    terug op 100 %, gedimd met de laag uit, en zoeken op "grootte".
 *
 * `#beeld=…` toont alleen een beeld voor een schermafbeelding: de regelaars
 * (regelaars-verkenner, regelaars-venster) of model-50, model-100, model-300.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as THREE from "three";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import "../src/components/fem/FemProjectTree.css";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import OpenFem3DVisibilityDialog from "../src/components/openFem3d/OpenFem3DVisibilityDialog";
import ExplorerViewTab from "../src/components/fem/ExplorerViewTab";
import { OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { OPEN_FEM_3D_SYMBOL_PERCENT_STOPS } from "../src/components/openFem3d/openFem3dSymbolScale";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import type { OpenFem3DPlateQuantity } from "../src/components/openFem3d/openFem3dPlateResults";
import type { OpenFem3DUtilization } from "../src/components/openFem3d/openFem3dUtilization";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
// @ts-expect-error -- esbuild laadt het projectbestand als tekst
import staalhalTekst from "../../docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

// De renderer, scène en camera waarmee het tekenvlak echt tekent (zoals in
// open-fem3d-selectie-browser.tsx): WebGLRenderer zet `render` in zijn
// constructor; een setter op het prototype omwikkelt die functie.
let renderCamera: THREE.Camera | null = null;
let renderScene: THREE.Object3D | null = null;
let renderRenderer: THREE.WebGLRenderer | null = null;
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  set(this: THREE.WebGLRenderer, fn: (scene: THREE.Object3D, camera: THREE.Camera) => void) {
    Object.defineProperty(this, "render", {
      configurable: true, writable: true,
      value: (scene: THREE.Object3D, cam: THREE.Camera) => {
        renderCamera = cam; renderScene = scene; renderRenderer = this;
        return fn.call(this, scene, cam);
      },
    });
  },
});

const BREED = 1000;
const HOOG = 700;
const tests: { name: string; error?: string }[] = [];
/** Meetwaarden voor het verslag (geen proeven). */
const info: string[] = [];
const container = document.getElementById("root")!;
let root = createRoot(container);
function mount(element: React.ReactNode) {
  flushSync(() => root.unmount());
  root = createRoot(container);
  flushSync(() => root.render(element));
}
const wacht = (ms = 40) => new Promise((r) => setTimeout(r, ms));
function ok(v: unknown, m: string) { if (!v) throw Error(m); }
function gelijk(a: unknown, b: unknown, m: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
function ongeveer(a: number, b: number, tol: number, m: string) {
  if (!(Math.abs(a - b) <= tol)) throw Error(`${m}: ${a.toFixed(3)} ≠ ${b} (± ${tol})`);
}
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}

/* ── Modellen ─────────────────────────────────────────────────────────── */

/**
 * Twee opleggingen op losse knopen (scharnier op 1, inklemming op 2), een
 * vrije knoop 3 zonder staaf (de knoopbol), en hoog daarboven een ligger met
 * aan beide einden een scharnier en een knooplast op knoop 5.
 */
const los: OpenFem3DModel = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 3, y: 0, z: 0 }, { id: 3, x: 1.5, y: 0, z: 1.6 },
    { id: 4, x: 0, y: 0, z: 3.4 }, { id: 5, x: 3, y: 0, z: 3.4 },
  ],
  beams: [{ id: 1, startNodeId: 4, endNodeId: 5, profileName: "IPE 300", material: "S235",
    releases: { myStart: true, mzStart: true, myEnd: true, mzEnd: true, torsionStart: false, torsionEnd: false } }],
  supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }, { nodeId: 2, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }],
  loads: [{ id: 1, nodeId: 5, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
});
/** Vier scharnieren op een rij: de opleggingstekens in GPU-batches. */
const rij: OpenFem3DModel = parseOpenFem3DModel({
  nodes: [0, 3, 6, 9].map((x, i) => ({ id: i + 1, x, y: 0, z: 0 })),
  beams: [],
  supports: [1, 2, 3, 4].map((nodeId) => ({ nodeId, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned })),
});
const staalhal: OpenFem3DModel = parseOpenFem3DModel(JSON.parse(staalhalTekst as string).model3d);
/** Een vloerplaat van 6 × 6 m, met of zonder randoplegging (scharnierend) op rand 1. */
const plaat = (metRand: boolean): OpenFem3DModel => parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 6, z: 0 }, { id: 4, x: 0, y: 6, z: 0 }],
  beams: [],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37",
    ...(metRand ? { edgeSupports: [{ edge: 0, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }] } : {}) }],
});
/** Een vloerplaat van 12 × 12 m met een scharnier op knoop 1 (voor de contour). */
const grotePlaat: OpenFem3DModel = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 12, y: 0, z: 0 }, { id: 3, x: 12, y: 12, z: 0 }, { id: 4, x: 0, y: 12, z: 0 }],
  beams: [],
  supports: [{ nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37" }],
});
/**
 * Een verzonnen resultaat, alleen voor de weergave: een net van n × n
 * elementen over plaat 1 (L × L m, in het vlak z = 0) met een doorbuiging w
 * als sinusbult. Genoeg voor de plaatlaag (net en contour w); staven en
 * reacties zijn er niet.
 */
function plaatResultaat(L: number, n: number): Resultaatlaag {
  const nodes: { id: number; x: number; y: number; z: number }[] = [];
  const shellNodes: { nodeId: number; plateId: number; wM: number }[] = [];
  const elements: { id: number; plateId: number; nodeIds: number[] }[] = [];
  const id = (i: number, j: number) => 1000 + i * (n + 1) + j;
  for (let i = 0; i <= n; i += 1) for (let j = 0; j <= n; j += 1) {
    nodes.push({ id: id(i, j), x: L * j / n, y: L * i / n, z: 0 });
    shellNodes.push({ nodeId: id(i, j), plateId: 1, wM: -0.001 * Math.sin(Math.PI * i / n) * Math.sin(Math.PI * j / n) });
  }
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    elements.push({ id: elements.length + 1, plateId: 1, nodeIds: [id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)] });
  }
  const result = {
    schemaVersion: 2, engine: { id: "proef", name: "proef", revision: "proef", license: "proef" }, analysis: "linear",
    displacements: [], reactions: [], memberForces: [], buckling: { modes: [] }, diagnostics: [],
    shellNodes, plates: [], shellElements: [],
    plateMesh: { nodes, elements, beamIntermediateNodes: new Map(), plateEdgeNodes: new Map(), plates: [], warnings: [] },
  } as unknown as OpenFem3DSolveResult;
  return { result, plateQuantity: "w" };
}
/** De dekking van de gewone plaatvlakken (onder een contour 0,15, anders 0,7). */
function plaatDekking(): number[] {
  const uit: number[] = [];
  renderScene!.traverse((o) => {
    if (o.userData.type !== "plate" || !(o as THREE.Mesh).isMesh) return;
    const materiaal = (o as THREE.Mesh).material as THREE.Material | THREE.Material[];
    uit.push(...(Array.isArray(materiaal) ? materiaal : [materiaal]).map((m) => m.opacity));
  });
  return uit;
}
/** Portaal voor de schermafbeeldingen: kolommen, ligger, scharnieren, last. */
const portaal: OpenFem3DModel = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 4 }, { id: 4, x: 6, y: 0, z: 0 },
    { id: 5, x: 0, y: 5, z: 0 }, { id: 6, x: 0, y: 5, z: 4 }, { id: 7, x: 6, y: 5, z: 4 }, { id: 8, x: 6, y: 5, z: 0 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 3, profileName: "IPE 300", material: "S235",
      releases: { myStart: true, mzStart: true, myEnd: true, mzEnd: true, torsionStart: false, torsionEnd: false } },
    { id: 3, startNodeId: 3, endNodeId: 4, profileName: "HEA 200", material: "S235" },
    { id: 4, startNodeId: 5, endNodeId: 6, profileName: "HEA 200", material: "S235" },
    { id: 5, startNodeId: 6, endNodeId: 7, profileName: "IPE 300", material: "S235" },
    { id: 6, startNodeId: 7, endNodeId: 8, profileName: "HEA 200", material: "S235" },
    { id: 7, startNodeId: 2, endNodeId: 6, profileName: "IPE 200", material: "S235" },
    { id: 8, startNodeId: 3, endNodeId: 7, profileName: "IPE 200", material: "S235" },
  ],
  supports: [
    { nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }, { nodeId: 4, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned },
    { nodeId: 5, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }, { nodeId: 8, ...OPEN_FEM_3D_SUPPORT_PRESETS.xRoller },
  ],
  loads: [{ id: 1, nodeId: 3, fx: 5, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
});

/* ── Opstelling ───────────────────────────────────────────────────────── */

// Eén vaste lege lijst: de standaardwaarde is elke render een nieuwe lijst,
// en dan neemt het tekenvlak nooit een snel pad.
const GEEN_BENUTTINGEN: OpenFem3DUtilization[] = [];
let selectie: OpenFem3DSelection = null;
/** De zichtbaarheid die het tekenvlak nu heeft (gezet door toon en zet). */
let huidigZicht: OpenFem3DVisibility = DEFAULT_OPEN_FEM_3D_VISIBILITY;
let zetZicht: (zicht: OpenFem3DVisibility) => void = () => {};
/** Een nieuwe (lege) lijst benuttingen: het tekenvlak bouwt dan volledig op, met dezelfde zichtbaarheid. */
let nieuweBenuttingen: () => void = () => {};
interface Resultaatlaag { result: OpenFem3DSolveResult; plateQuantity: OpenFem3DPlateQuantity }
function Tekenvlak({ model, zicht: beginZicht, camera, resultaat }: {
  model: OpenFem3DModel; zicht: OpenFem3DVisibility; camera?: OpenFem3DCameraState; resultaat?: Resultaatlaag;
}) {
  const [zicht, setZicht] = useState(beginZicht);
  const [benuttingen, setBenuttingen] = useState(GEEN_BENUTTINGEN);
  const [sel, setSel] = useState<OpenFem3DSelection>(null);
  zetZicht = (next) => flushSync(() => setZicht(next));
  nieuweBenuttingen = () => flushSync(() => setBenuttingen([]));
  return <div className="open-fem3d-stage" style={{ width: BREED, height: HOOG, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={sel}
      onSelect={(next) => { selectie = next; setSel(next); }}
      fitToken={0} visibility={zicht} utilizations={benuttingen}
      result={resultaat?.result ?? null} plateQuantity={resultaat?.plateQuantity ?? null}
      cameraRequest={camera ? { state: camera, token: 1 } : undefined} viewRequest={camera ? undefined : { kind: "iso", token: 1 }} />
  </div>;
}
async function toon(model: OpenFem3DModel, zicht: OpenFem3DVisibility, camera?: OpenFem3DCameraState, resultaat?: Resultaatlaag) {
  selectie = null;
  huidigZicht = zicht;
  mount(<Tekenvlak model={model} zicht={zicht} camera={camera} resultaat={resultaat} />);
  await wacht(250);
}
async function zet(zicht: OpenFem3DVisibility) {
  huidigZicht = zicht;
  zetZicht(zicht);
  await wacht(60);
}

const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;
const canvasEl = () => container.querySelector("canvas") as HTMLCanvasElement;
const bouwwijze = () => `${tekenvlakEl().dataset.openFem3dBuildMode}${tekenvlakEl().dataset.openFem3dBuildMode === "full" ? ` [${tekenvlakEl().dataset.openFem3dBuildHistory}]` : ""}`;
const cameraDiag = () => {
  const d = tekenvlakEl().dataset;
  return `${d.openFem3dCameraPosition}|${d.openFem3dCameraTarget}|${d.openFem3dOrthoHalfHeight}`;
};

/** Parallel, recht van voren (camera op −y), 2,8 m halve hoogte: 125 px per m; opleggingen, ligger en last in beeld. */
const VOOR: OpenFem3DCameraState = { position: [1.5, -30, 1.2], target: [1.5, 0, 1.2], up: [0, 0, 1], orthoHalfHeight: 2.8 };
/** Dichtbij de vrije knoop 3: 1 m halve hoogte, 350 px per m; alleen die knoop in beeld. */
const KNOOP: OpenFem3DCameraState = { position: [1.5, -30, 1.6], target: [1.5, 0, 1.6], up: [0, 0, 1], orthoHalfHeight: 1 };
const basis: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, perspective: false, grid: false, axes: false, structuralGrid: false, levelMarks: false,
  nodeNumbers: false, viewCube: false,
};

/* ── Beeldpunten ──────────────────────────────────────────────────────── */

function leesBeeld(): { data: Uint8Array; w: number; h: number } {
  ok(renderRenderer && renderScene && renderCamera, "er is getekend");
  renderRenderer!.render(renderScene!, renderCamera!);
  const gl = renderRenderer!.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const data = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return { data, w, h };
}
/** Beeldpunt (tekenbuffer, oorsprong linksonder) van een wereldpunt. */
function buffer(p: THREE.Vector3, w: number, h: number) {
  const n = p.clone().project(renderCamera!);
  return { x: Math.round((n.x + 1) / 2 * w), y: Math.round((n.y + 1) / 2 * h) };
}
interface Masker {
  aantal: number; breedte: number; hoogte: number;
  midden: { x: number; y: number }; half: number; w: number; h: number;
  in: (x: number, y: number) => boolean;
}
/**
 * De beeldpunten van wat `verberg` aanwijst, in een venster van ±`half` px
 * rond wereldpunt `rond`: het verschil tussen het beeld met en zonder die
 * objecten. Daarna staat alles weer zichtbaar.
 */
function masker(verberg: (o: THREE.Object3D) => boolean, rond: THREE.Vector3, half: number): Masker {
  const voor = leesBeeld();
  const weg: THREE.Object3D[] = [];
  renderScene!.traverse((o) => { if (o.visible && verberg(o)) weg.push(o); });
  ok(weg.length > 0, "niets te verbergen");
  weg.forEach((o) => { o.visible = false; });
  const na = leesBeeld();
  weg.forEach((o) => { o.visible = true; });
  renderRenderer!.render(renderScene!, renderCamera!);
  const { w, h } = voor;
  const midden = buffer(rond, w, h);
  const aan = new Set<number>();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = Math.max(0, midden.y - half); y <= Math.min(h - 1, midden.y + half); y += 1) {
    for (let x = Math.max(0, midden.x - half); x <= Math.min(w - 1, midden.x + half); x += 1) {
      const i = (y * w + x) * 4;
      const verschil = Math.abs(voor.data[i]! - na.data[i]!) + Math.abs(voor.data[i + 1]! - na.data[i + 1]!) + Math.abs(voor.data[i + 2]! - na.data[i + 2]!);
      if (verschil <= 24) continue;
      aan.add(y * w + x);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return {
    aantal: aan.size, breedte: aan.size ? maxX - minX + 1 : 0, hoogte: aan.size ? maxY - minY + 1 : 0,
    midden, half, w, h, in: (x, y) => aan.has(y * w + x),
  };
}
const isKnoopbol = (o: THREE.Object3D) => o.userData.openFem3dNodeVisual === true;
function inConditielaag(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o.parent; p; p = p.parent) if (p.userData.openFem3dConditions === true) return true;
  return false;
}
const isOplegging = (o: THREE.Object3D) => inConditielaag(o) && o.userData.type === "node" && (o as THREE.Mesh).isMesh === true;
const isLast = (o: THREE.Object3D) => inConditielaag(o) && o.userData.type === "nodalLoad";
const punt = (model: OpenFem3DModel, id: number) => { const n = model.nodes.find((k) => k.id === id)!; return new THREE.Vector3(n.x, n.y, n.z); };

/** Een klik op beeldpunt (x, y) van de tekenbuffer. */
function klikBuffer(x: number, y: number, w: number, h: number) {
  const canvas = canvasEl();
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + (x + 0.5) * rect.width / w;
  const clientY = rect.top + (h - y - 0.5) * rect.height / h;
  for (const [type, knoppen] of [["pointerdown", 1], ["pointerup", 0]] as const) {
    flushSync(() => canvas.dispatchEvent(new PointerEvent(type, {
      clientX, clientY, button: 0, buttons: knoppen, pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true,
    })));
  }
}
/**
 * Een beeldpunt dat ruim binnen `groot` en ruim buiten `klein` ligt (3 × 3
 * buren, en 4 px rond het punt niets van `klein`), minstens `minAfstand` px
 * van het midden; het dichtstbijzijnde zo'n punt.
 */
function alleenInGroot(groot: Masker, klein: Masker, minAfstand = 0) {
  let beste: { x: number; y: number; d: number } | null = null;
  const { midden, half } = groot;
  for (let y = midden.y - half + 1; y < midden.y + half; y += 1) {
    for (let x = midden.x - half + 1; x < midden.x + half; x += 1) {
      let goed = true;
      for (let dy = -1; dy <= 1 && goed; dy += 1) for (let dx = -1; dx <= 1 && goed; dx += 1) {
        goed = groot.in(x + dx, y + dy) && !klein.in(x + dx, y + dy);
      }
      // Liefst ver van de rand van het kleine teken: tot 4 px eromheen niets.
      if (goed) for (let dy = -4; dy <= 4 && goed; dy += 1) for (let dx = -4; dx <= 4 && goed; dx += 1) goed = !klein.in(x + dx, y + dy);
      if (!goed) continue;
      const d = Math.hypot(x - midden.x, y - midden.y);
      if (d < minAfstand) continue;
      if (!beste || d < beste.d) beste = { x, y, d };
    }
  }
  ok(beste, "geen beeldpunt dat alleen bij de grote maat geraakt wordt");
  return beste!;
}

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  const hash = new URLSearchParams(location.hash.slice(1));
  const beeld = hash.get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("knoopbol: bij 200 % twee keer zo groot op het scherm als bij 100 %, bij 50 % half zo groot; camera gelijk", async () => {
    await toon(los, { ...basis, supports: false, loads: false }, KNOOP);
    ongeveer(Number(tekenvlakEl().dataset.openFem3dOrthoHalfHeight), 1, 1e-6, "parallel, halve hoogte van de camera");
    const camera = cameraDiag();
    const knoop = punt(los, 3);
    const m100 = masker(isKnoopbol, knoop, 140);
    ok(m100.breedte >= 40, `knoopbol bij 100 % ${m100.breedte} px breed`);
    await zet({ ...huidigZicht, nodeSizePercent: 200 });
    gelijk(bouwwijze(), "node-scale", "snel pad");
    gelijk(cameraDiag(), camera, "camera ongewijzigd");
    const m200 = masker(isKnoopbol, knoop, 140);
    ongeveer(m200.breedte / m100.breedte, 2, 0.06, "breedte 200 % / 100 %");
    ongeveer(m200.hoogte / m100.hoogte, 2, 0.06, "hoogte 200 % / 100 %");
    ongeveer(Math.sqrt(m200.aantal / m100.aantal), 2, 0.05, "√oppervlak 200 % / 100 %");
    await zet({ ...huidigZicht, nodeSizePercent: 50 });
    const m50 = masker(isKnoopbol, knoop, 140);
    ongeveer(m50.breedte / m100.breedte, 0.5, 0.06, "breedte 50 % / 100 %");
    info.push(`knoopbol: ${m50.breedte} / ${m100.breedte} / ${m200.breedte} px breed bij 50 / 100 / 200 %`);
  });

  await test("knoopbol kiezen: een klik die alleen bij 200 % op de bol valt, kiest bij 200 % de knoop en bij 100 % niets", async () => {
    await toon(los, { ...basis, supports: false, loads: false }, KNOOP);
    const knoop = punt(los, 3);
    const m100 = masker(isKnoopbol, knoop, 140);
    await zet({ ...huidigZicht, nodeSizePercent: 200 });
    const m200 = masker(isKnoopbol, knoop, 140);
    // Halverwege de rand van de kleine en de grote bol: buiten de kiesstraal
    // bij 100 % (straal + 1 px), binnen de bol bij 200 %.
    const p = alleenInGroot(m200, m100, 0.75 * m200.breedte / 2);
    ok(p.d > m100.breedte / 2 + 6, `klikpunt ${p.d.toFixed(1)} px van het midden, buiten de kleine bol (${m100.breedte / 2} px)`);
    klikBuffer(p.x, p.y, m200.w, m200.h);
    gelijk(selectie, { type: "node", id: 3 }, "200 %: de knoop");
    await zet({ ...huidigZicht, nodeSizePercent: 100 });
    selectie = null;
    klikBuffer(p.x, p.y, m200.w, m200.h);
    gelijk(selectie, null, "100 %: naast de bol, niets");
  });

  await test("knoopbol kiezen bij 200 % en 400 %: op de halve straal en vlak bij de rand (0,95 · r) kiest de knoop", async () => {
    // Het zoekgebied om de klik (48 px bij 100 %) groeit mee met de knoopschaal;
    // anders kiest bij 400 % (straal ruim 100 px) zelfs de halve straal niets.
    await toon(los, { ...basis, supports: false, loads: false }, KNOOP);
    const knoop = punt(los, 3);
    for (const procent of [200, 400]) {
      await zet({ ...huidigZicht, nodeSizePercent: procent });
      const m = masker(isKnoopbol, knoop, 260);
      const r = m.breedte / 2;
      ok(r > 48, `${procent} %: straal ${r} px, groter dan het oude zoekgebied van 48 px`);
      for (const k of [0.5, 0.95]) {
        const y = m.midden.y + Math.round(k * r);
        ok(m.in(m.midden.x, y), `${procent} %: ${k} · r ligt op de bol`);
        selectie = null;
        klikBuffer(m.midden.x, y, m.w, m.h);
        gelijk(selectie, { type: "node", id: 3 }, `${procent} %: klik op ${k} · r (${Math.round(k * r)} px van het midden)`);
      }
      info.push(`kiezen bij ${procent} %: straal ${r} px, klik op 0,5 en 0,95 · r kiest de knoop`);
    }
  });

  await test("volledige opbouw met knopen op 200 % (bewaarde stand, modelwijziging): bol twee keer zo groot, kiezen op de grote bol", async () => {
    // De weg bij het openen met een bewaarde stand en na elke modelwijziging:
    // geen snel pad, de straal komt uit de volledige opbouw (visualNodeRadiusRef).
    await toon(los, { ...basis, supports: false, loads: false }, KNOOP);
    const knoop = punt(los, 3);
    const m100 = masker(isKnoopbol, knoop, 140);
    await toon(los, { ...basis, supports: false, loads: false, nodeSizePercent: 200 }, KNOOP);
    ok(/full/.test(bouwwijze() ?? ""), `volledige opbouw (${bouwwijze()})`);
    const m200 = masker(isKnoopbol, knoop, 140);
    ongeveer(m200.breedte / m100.breedte, 2, 0.06, "breedte 200 % / 100 %, beide volledig opgebouwd");
    const p = alleenInGroot(m200, m100, 0.75 * m200.breedte / 2);
    ok(p.d > m100.breedte / 2 + 6, `klikpunt ${p.d.toFixed(1)} px van het midden, buiten de bol van 100 %`);
    klikBuffer(p.x, p.y, m200.w, m200.h);
    gelijk(selectie, { type: "node", id: 3 }, "de kiesstraal volgt de geschaalde bol");
  });

  await test("regelaar, daarna een volledige opbouw met dezelfde zichtbaarheid: de plaat onder de contour blijft doorzichtig", async () => {
    // Nieuwe benuttingen bouwen alles opnieuw op (ook de plaatvlakken, weer
    // ondoorzichtig); de plaatlaag moet daarna haar contourdekking opnieuw zetten.
    const resultaat = plaatResultaat(12, 30);
    const zicht = { ...basis, deformation: false, reactions: false };
    for (const [sleutel, wijze] of [["nodeSizePercent", "node-scale"], ["supportSizePercent", "support-scale"]] as const) {
      await toon(grotePlaat, zicht, undefined, resultaat);
      gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "contour:w", `${sleutel}: contour`);
      gelijk(plaatDekking(), [0.15], `${sleutel}: dekking bij het begin`);
      await zet({ ...huidigZicht, [sleutel]: 200 });
      gelijk(bouwwijze(), wijze, `${sleutel}: snel pad`);
      gelijk(plaatDekking(), [0.15], `${sleutel}: dekking na de regelaar`);
      nieuweBenuttingen();
      await wacht(80);
      ok(/full/.test(bouwwijze() ?? ""), `${sleutel}: volledige opbouw na nieuwe benuttingen (${bouwwijze()})`);
      gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "contour:w", `${sleutel}: contour na de opbouw`);
      gelijk(plaatDekking(), [0.15], `${sleutel}: dekking na de volledige opbouw`);
    }
  });

  await test("opleggingsteken: bij 200 % twee keer zo groot, bij 50 % half zo groot (scharnier en inklemming)", async () => {
    await toon(los, { ...basis, nodes: false, loads: false }, VOOR);
    for (const id of [1, 2]) {
      await zet({ ...huidigZicht, supportSizePercent: 100 });
      const m100 = masker(isOplegging, punt(los, id), 140);
      ok(m100.breedte >= 40, `oplegging ${id} bij 100 % ${m100.breedte} px breed`);
      await zet({ ...huidigZicht, supportSizePercent: 200 });
      gelijk(bouwwijze(), "support-scale", "snel pad");
      const m200 = masker(isOplegging, punt(los, id), 140);
      ongeveer(m200.breedte / m100.breedte, 2, 0.06, `oplegging ${id}: breedte 200 % / 100 %`);
      ongeveer(m200.hoogte / m100.hoogte, 2, 0.08, `oplegging ${id}: hoogte 200 % / 100 %`);
      ongeveer(Math.sqrt(m200.aantal / m100.aantal), 2, 0.06, `oplegging ${id}: √oppervlak`);
      await zet({ ...huidigZicht, supportSizePercent: 50 });
      const m50 = masker(isOplegging, punt(los, id), 140);
      ongeveer(m50.breedte / m100.breedte, 0.5, 0.06, `oplegging ${id}: breedte 50 % / 100 %`);
      info.push(`oplegging ${id}: ${m50.breedte} / ${m100.breedte} / ${m200.breedte} px breed bij 50 / 100 / 200 %`);
    }
  });

  await test("het snelle pad tekent precies wat een volledige opbouw bij die maat tekent", async () => {
    await toon(los, { ...basis, nodes: false, loads: false }, VOOR);
    await zet({ ...huidigZicht, supportSizePercent: 300 });
    gelijk(bouwwijze(), "support-scale", "snel pad");
    const snel = masker(isOplegging, punt(los, 1), 200);
    await toon(los, { ...basis, nodes: false, loads: false, supportSizePercent: 300 }, VOOR);
    ok(/full/.test(bouwwijze() ?? ""), `volledige opbouw (${bouwwijze()})`);
    const vol = masker(isOplegging, punt(los, 1), 200);
    ongeveer(snel.aantal / vol.aantal, 1, 0.01, "oppervlak gelijk");
    ongeveer(snel.breedte, vol.breedte, 1, "breedte gelijk");
    ongeveer(snel.hoogte, vol.hoogte, 1, "hoogte gelijk");
  });

  await test("opleggingsteken kiezen: een klik die alleen bij 200 % op het teken valt, kiest bij 200 % de knoop en bij 100 % niets", async () => {
    await toon(los, { ...basis, nodes: false, loads: false }, VOOR);
    const m100 = masker(isOplegging, punt(los, 1), 140);
    await zet({ ...huidigZicht, supportSizePercent: 200 });
    const m200 = masker(isOplegging, punt(los, 1), 140);
    const p = alleenInGroot(m200, m100);
    klikBuffer(p.x, p.y, m200.w, m200.h);
    gelijk(selectie, { type: "node", id: 1 }, "200 %: de knoop van de oplegging");
    await zet({ ...huidigZicht, supportSizePercent: 100 });
    selectie = null;
    klikBuffer(p.x, p.y, m200.w, m200.h);
    gelijk(selectie, null, "100 %: naast het teken, niets");
  });

  await test("in een GPU-batch (vier scharnieren): elk teken twee keer zo groot, kiezen werkt", async () => {
    const rijCamera: OpenFem3DCameraState = { position: [4.5, -30, 0], target: [4.5, 0, 0], up: [0, 0, 1], orthoHalfHeight: 4 };
    await toon(rij, { ...basis, nodes: false }, rijCamera);
    let batch = 0;
    renderScene!.traverse((o) => { if (isOplegging(o) && o instanceof THREE.InstancedMesh) batch += 1; });
    ok(batch > 0, "opleggingstekens in GPU-batches");
    const m100 = masker(isOplegging, punt(rij, 2), 120);
    await zet({ ...huidigZicht, supportSizePercent: 200 });
    gelijk(bouwwijze(), "support-scale", "snel pad");
    const m200 = masker(isOplegging, punt(rij, 2), 120);
    ongeveer(m200.breedte / m100.breedte, 2, 0.06, "breedte 200 % / 100 %");
    const p = alleenInGroot(m200, m100);
    klikBuffer(p.x, p.y, m200.w, m200.h);
    gelijk(selectie, { type: "node", id: 2 }, "200 %: knoop 2");
  });

  await test("de lasten veranderen niet met de opleggingsschaal (beeldpunt voor beeldpunt)", async () => {
    await toon(los, { ...basis }, VOOR);
    const last100 = masker(isLast, punt(los, 5), 100);
    ok(last100.aantal > 30, `lastpijl getekend (${last100.aantal} px)`);
    await zet({ ...huidigZicht, supportSizePercent: 300 });
    gelijk(bouwwijze(), "support-scale", "snel pad");
    const last300 = masker(isLast, punt(los, 5), 100);
    gelijk([last300.aantal, last300.breedte, last300.hoogte], [last100.aantal, last100.breedte, last100.hoogte], "lastpijl gelijk");
  });

  await test("de scharnierbolletjes volgen de knoopbol (200 %: twee keer zo groot), ook langs het snelle pad", async () => {
    await toon(los, { ...basis, supports: false, loads: false }, VOOR);
    const stralen = () => {
      const uit: number[] = [];
      renderScene!.traverse((o) => {
        if (o.userData.openFem3dBeamHinge !== true || o.userData.openFem3dBeamHingeRim === true) return;
        if (o instanceof THREE.InstancedMesh) {
          const m = new THREE.Matrix4(), s = new THREE.Vector3();
          for (let i = 0; i < o.count; i += 1) { o.getMatrixAt(i, m); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s); uit.push(s.x); }
        } else uit.push(o.scale.x);
      });
      return uit.sort();
    };
    const voor = stralen();
    gelijk(voor.length, 2, "twee scharnierbolletjes");
    await zet({ ...huidigZicht, nodeSizePercent: 200 });
    gelijk(bouwwijze(), "node-scale", "snel pad");
    const na = stralen();
    gelijk(na.length, 2, "nog twee");
    na.forEach((r, i) => ongeveer(r / voor[i]!, 2, 1e-6, `bolletje ${i + 1}`));
  });

  await test("staalhal 60 × 30 m met 412 lijnlasten: beide regelaars zonder opbouw; alleen knoopbollen, scharnierbolletjes of opleggingen wijzigen", async () => {
    // Tijd meten kan hier niet (de headless browser draait op virtuele tijd).
    // Bewijs van "geen opbouw": de objecten van de scène blijven dezelfde.
    await toon(staalhal, { ...basis, perspective: true });
    const laag = () => {
      let groep: THREE.Object3D | null = null;
      renderScene!.traverse((o) => { if (o.userData.openFem3dConditions === true) groep = o.parent; });
      ok(groep, "scènegroep");
      return [...groep!.children];
    };
    const geschiedenis = () => tekenvlakEl().dataset.openFem3dBuildHistory ?? "";
    for (const [sleutel, waarde, wijze] of [["nodeSizePercent", 250, "node-scale"], ["supportSizePercent", 250, "support-scale"],
      ["nodeSizePercent", 60, "node-scale"], ["supportSizePercent", 60, "support-scale"]] as const) {
      const voor = laag();
      await zet({ ...huidigZicht, [sleutel]: waarde });
      gelijk(bouwwijze(), wijze, `${sleutel} ${waarde}`);
      const na = laag();
      const nieuw = na.filter((o) => !voor.includes(o));
      // Knopen: alleen de laag met scharnierbolletjes is nieuw; opleggingen: niets.
      ok(nieuw.every((o) => o.userData.openFem3dBeamHinges === true) && (wijze === "node-scale" || nieuw.length === 0),
        `${wijze}: nieuwe objecten ${nieuw.map((o) => o.type).join(",")}`);
      ok(na.length === voor.length, `${wijze}: ${voor.length} → ${na.length} objecten`);
    }
    ok(!/full/.test(geschiedenis().split(",").slice(-4).join(",")), `geen volledige opbouw: ${geschiedenis()}`);
    info.push(`staalhal: ${staalhal.supports?.length} opleggingen, ${tekenvlakEl().dataset.openFem3dScaledSupportParts} geschaalde delen; ${staalhal.memberLoads?.length} lijnlasten onaangeroerd`);
  });

  await test("platen: de regelaars laten de plaatlaag staan; met randopleggingen schalen hun tekens mee", async () => {
    const overlay = () => renderScene!.getObjectByName("open-fem3d-plate-overlay");
    const kegelHoogte = () => {
      let hoogte = 0;
      overlay()?.getObjectByName("open-fem3d-plate-edge-supports")?.children.forEach((c) => {
        const g = (c as THREE.Mesh).geometry as THREE.ConeGeometry | undefined;
        if (g?.type === "ConeGeometry") hoogte = Math.max(hoogte, g.parameters.height);
      });
      return hoogte;
    };
    await toon(plaat(false), { ...basis });
    const zonderRand = overlay();
    ok(zonderRand, "plaatlaag");
    await zet({ ...huidigZicht, nodeSizePercent: 200 });
    gelijk(bouwwijze(), "node-scale", "Knopen: snel pad");
    ok(overlay() === zonderRand, "Knopen: plaatlaag niet opnieuw opgebouwd");
    await zet({ ...huidigZicht, supportSizePercent: 200 });
    gelijk(bouwwijze(), "support-scale", "Opleggingen: snel pad");
    ok(overlay() === zonderRand, "Opleggingen zonder randopleggingen: plaatlaag niet opnieuw opgebouwd");
    // Met randopleggingen, rekennet en contour: bij Opleggingen wordt alleen de
    // groep met randopleggingen vervangen, net en contour blijven staan (een
    // groot net opnieuw opbouwen kost per stand tientallen ms).
    // Plaatweergave mesh (issue #78): de elementlijnen van het rekennet staan erbij.
    await toon(plaat(true), { ...basis, plateDisplay: "mesh", deformation: false, reactions: false }, undefined, plaatResultaat(6, 24));
    gelijk(tekenvlakEl().dataset.openFem3dPlateOverlay, "contour:w", "contour");
    const metRand = overlay();
    const delen = () => {
      const kinderen = overlay()?.children ?? [];
      return {
        net: kinderen.find((c) => c.userData.openFem3dPlateMesh !== undefined),
        contour: kinderen.find((c) => c.userData.openFem3dPlateContour !== undefined),
        rand: overlay()?.getObjectByName("open-fem3d-plate-edge-supports"),
      };
    };
    const voor = delen();
    ok(voor.net && voor.contour && voor.rand, "net, contour en randopleggingen getekend");
    const h100 = kegelHoogte();
    ok(h100 > 0, "randopleggingen getekend");
    await zet({ ...huidigZicht, nodeSizePercent: 200 });
    ok(overlay() === metRand, "Knopen: plaatlaag niet opnieuw opgebouwd");
    ok(delen().rand === voor.rand, "Knopen: randopleggingen ongemoeid");
    for (const procent of [150, 200]) {
      await zet({ ...huidigZicht, supportSizePercent: procent });
      gelijk(bouwwijze(), "support-scale", `Opleggingen ${procent} %: snel pad in de scène`);
      ok(overlay() === metRand, `Opleggingen ${procent} %: de plaatlaag blijft staan`);
      const na = delen();
      ok(na.net === voor.net && na.contour === voor.contour, `Opleggingen ${procent} %: net en contour niet opnieuw opgebouwd`);
      ok(na.rand && na.rand !== voor.rand, `Opleggingen ${procent} %: alleen de randopleggingen vervangen`);
      ok(Number(tekenvlakEl().dataset.openFem3dEdgeSupportGlyphs) > 0, `Opleggingen ${procent} %: tekens geteld`);
      ongeveer(kegelHoogte() / h100, procent / 100, 1e-9, `randteken ${procent} % / 100 %`);
      voor.rand = na.rand;
    }
    gelijk(plaatDekking(), [0.15], "de plaat onder de contour blijft doorzichtig");
    await zet({ ...huidigZicht, supports: false });
    ok(!delen().rand, "Opleggingen uit: geen randopleggingen");
    await zet({ ...huidigZicht, supportSizePercent: 300 });
    ok(!delen().rand, "Opleggingen uit en een andere maat: nog steeds geen randopleggingen");
    await zet({ ...huidigZicht, supports: true });
    ongeveer(kegelHoogte() / h100, 3, 1e-9, "weer aan: randteken op 300 %");
  });

  await test("verkenner: de regelaar Grootte direct onder Knopen en onder Opleggingen, waarde 100 %", async () => {
    mountVerkenner({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY });
    const regelaars = [...container.querySelectorAll<HTMLElement>("[data-open-fem3d-symbol-scale]")];
    gelijk(regelaars.map((el) => el.dataset.openFem3dSymbolScale), ["nodes", "supports"], "twee regelaars");
    for (const el of regelaars) {
      const label = el.previousElementSibling?.querySelector(".fem-results-toggle-label")?.textContent;
      gelijk(label, el.dataset.openFem3dSymbolScale === "nodes" ? "Knopen" : "Opleggingen", "direct onder zijn schakelaar");
      gelijk(el.querySelector("button")?.textContent, "100 %", "waarde");
      gelijk(el.querySelector("input")?.getAttribute("aria-valuetext"), "100 %", "aria-valuetext");
      gelijk(el.querySelector("input")?.value, String(OPEN_FEM_3D_SYMBOL_PERCENT_STOPS.indexOf(100)), "regelaar in het midden");
    }
  });

  await test("verkenner: schuiven zet de waarde, dubbelklik en de waardeknop zetten terug op 100 %", async () => {
    mountVerkenner({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY });
    const schuif = (doel: "nodes" | "supports", stand: number) => {
      const input = container.querySelector<HTMLInputElement>(`[data-open-fem3d-symbol-scale="${doel}"] input`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(stand));
      flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
    };
    schuif("nodes", OPEN_FEM_3D_SYMBOL_PERCENT_STOPS.indexOf(200));
    gelijk(verkennerZicht.nodeSizePercent, 200, "knopen 200 %");
    gelijk(verkennerZicht.supportSizePercent, 100, "opleggingen ongemoeid");
    gelijk(container.querySelector('[data-open-fem3d-symbol-scale="nodes"] button')?.textContent, "200 %", "waarde zichtbaar");
    schuif("supports", 0);
    gelijk(verkennerZicht.supportSizePercent, 25, "opleggingen 25 %");
    const input = container.querySelector<HTMLInputElement>('[data-open-fem3d-symbol-scale="nodes"] input')!;
    flushSync(() => input.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    gelijk(verkennerZicht.nodeSizePercent, 100, "dubbelklik: 100 %");
    flushSync(() => container.querySelector<HTMLButtonElement>('[data-open-fem3d-symbol-scale="supports"] button')!.click());
    gelijk(verkennerZicht.supportSizePercent, 100, "klik op de waarde: 100 %");
  });

  await test("verkenner: met de laag uit is de regelaar gedimd; zoeken op 'grootte' toont beide", async () => {
    mountVerkenner({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, supports: false });
    ok(container.querySelector<HTMLInputElement>('[data-open-fem3d-symbol-scale="supports"] input')!.disabled, "opleggingen uit: gedimd");
    ok(!container.querySelector<HTMLInputElement>('[data-open-fem3d-symbol-scale="nodes"] input')!.disabled, "knopen aan: bruikbaar");
    const zoek = container.querySelector<HTMLInputElement>('.explorer-view-search input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(zoek, "grootte");
    flushSync(() => zoek.dispatchEvent(new Event("input", { bubbles: true })));
    gelijk([...container.querySelectorAll<HTMLElement>("[data-open-fem3d-symbol-scale]")].map((el) => el.dataset.openFem3dSymbolScale),
      ["nodes", "supports"], "beide regelaars gevonden");
  });

  await test("venster Zichtbaarheid: de regelaars onder Knopen en Opleggingen; schuiven en Standaard", async () => {
    let zicht: OpenFem3DVisibility = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
    const Venster = () => {
      const [v, setV] = useState(zicht);
      return <OpenFem3DVisibilityDialog open onClose={() => {}} visibility={v} onChange={(next) => { zicht = next; setV(next); }}
        viewSets={[]} currentView="iso" currentCamera={{ position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] }}
        currentCombinationId={null} currentLoadCaseId={1} currentMode="model" combinationOptions={[]} loadCaseOptions={[]} />;
    };
    mount(<Venster />);
    const regelaars = [...document.querySelectorAll<HTMLElement>(".open-fem3d-visibility-dialog [data-open-fem3d-symbol-scale]")];
    gelijk(regelaars.map((el) => el.dataset.openFem3dSymbolScale), ["nodes", "supports"], "twee regelaars in het venster");
    gelijk(regelaars.map((el) => (el.previousElementSibling as HTMLElement | null)?.dataset.vlag), ["nodes", "supports"], "direct onder hun schakelaar");
    const input = regelaars[1]!.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(OPEN_FEM_3D_SYMBOL_PERCENT_STOPS.indexOf(300)));
    flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
    gelijk(zicht.supportSizePercent, 300, "opleggingen 300 %");
    const standaard = [...document.querySelectorAll<HTMLButtonElement>(".open-fem3d-visibility-dialog .modal-footer button")]
      .find((b) => b.textContent === i18next.t("zichtbaarheid.standaard"))!;
    flushSync(() => standaard.click());
    gelijk([zicht.nodeSizePercent, zicht.supportSizePercent], [100, 100], "Standaard: terug op 100 %");
    mount(null);
  });
}

let verkennerZicht: OpenFem3DVisibility = DEFAULT_OPEN_FEM_3D_VISIBILITY;
function mountVerkenner(begin: OpenFem3DVisibility, breedte = 240) {
  verkennerZicht = begin;
  const Verkenner = () => {
    const [v, setV] = useState(begin);
    return <div style={{ width: breedte }} className="fem-project-tree">
      <ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} workspace="3d"
        gridShow={false} setGridShow={() => {}} stramienAan setStramienAan={() => {}}
        openFem3dVisibility={v} setOpenFem3DVisibility={(next) => { verkennerZicht = next; setV(next); }} />
    </div>;
  };
  mount(<Verkenner />);
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  // De regelaars bij 150 % (knopen) en 60 % (opleggingen, met de laag uit in de verkenner: gedimd).
  if (beeld === "regelaars-verkenner") {
    const zicht = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, nodeSizePercent: 150, supportSizePercent: 60, supports: false };
    mount(<div style={{ padding: 12, background: "#fff" }}>
      <div style={{ width: 240, height: 520, overflow: "hidden", border: "1px solid #cbd5e1" }} className="fem-project-tree">
        <ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} workspace="3d"
          gridShow={false} setGridShow={() => {}} stramienAan setStramienAan={() => {}}
          openFem3dVisibility={zicht} setOpenFem3DVisibility={() => {}} />
      </div>
    </div>);
    await wacht(200);
    return;
  }
  if (beeld === "regelaars-venster") {
    const zicht = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, nodeSizePercent: 150, supportSizePercent: 60 };
    mount(<OpenFem3DVisibilityDialog open onClose={() => {}} visibility={zicht} onChange={() => {}}
      viewSets={[]} currentView="iso" currentCamera={{ position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] }}
      currentCombinationId={null} currentLoadCaseId={1} currentMode="model" combinationOptions={[]} loadCaseOptions={[]} />);
    await wacht(200);
    return;
  }
  const procent = Number(/^model-(\d+)$/.exec(beeld)?.[1] ?? 100);
  await toon(portaal, { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, grid: false, structuralGrid: false, levelMarks: false,
    nodeSizePercent: procent, supportSizePercent: procent });
  await wacht(300);
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, info, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, info, error: String(e?.stack ?? e) }); });
