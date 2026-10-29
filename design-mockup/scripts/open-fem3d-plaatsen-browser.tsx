/**
 * Browserkant van test-open-fem3d-plaatsen-ui.mjs: plaatsen op een object
 * (issues #76 en #77) in de echte 3D-werkruimte (OpenFem3DEditor met
 * ThreeFrameCanvas, WebGL) en het echte eigenschappenpaneel, met echte
 * klikken op het tekenvlak. De aanroepen voor oplegging en puntlast gebruiken
 * dezelfde zuivere functies als App.tsx (openFem3DNodeToolClick in
 * applyOpenFem3DNodeTool, placeOpenFem3DPointLoad in
 * applyOpenFem3DPointLoadTool): één modelwijziging, de nieuwe knoop of last
 * geselecteerd.
 *
 * Bewaakt:
 *  - oplegging: een klik op de ligger vlak naast een knoop → die knoop (geen
 *    splitsing), ook aan de camerazijde (de ligger of de plaat loopt naar de
 *    camera toe en de klikstraal raakt hem ruim vóór de knoop), met en zonder
 *    eindscharnier, voor oplegging, veer en puntlast; een knoop die door de
 *    plaat heen te zien is, telt niet; midden op de ligger → gesplitst, nieuwe knoop met oplegging,
 *    één wijziging, lijnlast verdeeld; bij knoopschaal 400 % vangt de
 *    vergrote bol ook buiten 14 px, bij 100 % is dezelfde plek de staaf;
 *  - oplegging op de vloerplaat: nieuwe knoop in het middenvlak met het level
 *    van de plaat, en het getekende rekennet (weergave Mesh) heeft er een
 *    hoekpunt; een klik in de opening maakt geen knoop in de plaat;
 *  - veer op de ligger: ook gesplitst, met de veer;
 *  - puntlast: op een knoop een knooplast, op de ligger een staafpuntlast op
 *    de aangeklikte plek, het paneel open met de nieuwe last; op de plaat of
 *    in leeg canvas niets, met een melding; Esc stopt het gereedschap;
 *  - lint: Puntlast zonder selectie zet het gereedschap aan, met een knoop of
 *    staaf het formulier zoals voorheen; de kop toont de hulptekst.
 *
 * `#beeld=plaat-oplegging` en `#beeld=puntlast-staaf` tonen alleen het beeld
 * na de plaatsing, voor een schermafbeelding. De uitslag komt als JSON in #uitslag.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as THREE from "three";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import check from "../src/i18n/locales/nl/check.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import "../src/App.css";
import "../src/components/ribbon/Ribbon.css";
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import OpenFem3DProperties from "../src/components/openFem3d/OpenFem3DProperties";
import HomeTab from "../src/components/ribbon/HomeTab";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { openFem3DNodeToolClick, type OpenFem3DNodeTarget } from "../src/components/openFem3d/openFem3dNodeTools";
import { placeOpenFem3DPointLoad, type OpenFem3DPointLoadTarget } from "../src/components/openFem3d/openFem3dPlaatsen";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DTool } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { StructuralGrid } from "../src/components/fem/femTypes";


// Ontwerp 0.4 (RibbonButton): een lintknop heeft geen title-attribuut meer. De
// uitleg staat in de eigen tooltip en, voor schermlezers, in aria-label als
// "<naam>. <uitleg>".
const lintUitleg = (b?: HTMLButtonElement | null): string => {
  const label = b?.querySelector(".ribbon-btn-label")?.textContent ?? "";
  const aria = b?.getAttribute("aria-label") ?? "";
  return aria.startsWith(`${label}. `) ? aria.slice(label.length + 2) : "";
};

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

// De camera en scène waarmee het tekenvlak echt tekent (zoals in open-fem3d-plaatweergave-browser.tsx).
let renderCamera: THREE.Camera | null = null;
let renderScene: THREE.Object3D | null = null;
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  set(this: THREE.WebGLRenderer, fn: (scene: THREE.Object3D, camera: THREE.Camera) => void) {
    Object.defineProperty(this, "render", {
      configurable: true, writable: true,
      value: (scene: THREE.Object3D, cam: THREE.Camera) => {
        renderCamera = cam; renderScene = scene;
        return fn.call(this, scene, cam);
      },
    });
  },
});

const tests: { name: string; error?: string }[] = [];
const info: string[] = [];
const container = document.getElementById("root")!;
let root = createRoot(container);
function mount(element: React.ReactNode) {
  flushSync(() => root.unmount());
  root = createRoot(container);
  flushSync(() => root.render(element));
}
const wacht = (ms = 80) => new Promise((r) => setTimeout(r, ms));
function ok(v: unknown, m: string) { if (!v) throw Error(m); }
function gelijk(a: unknown, b: unknown, m: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
function ongeveer(a: number, b: number, tol: number, m: string) {
  if (!(Math.abs(a - b) <= tol)) throw Error(`${m}: ${a} ≠ ${b} (± ${tol})`);
}
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}

/* ── Model ────────────────────────────────────────────────────────────── */

const LEVELS = [{ id: "peil0", label: "Peil 0", position: 0 }, { id: "v1", label: "1e verdieping", position: 3000 }];
const GRID: StructuralGrid = { enabled: false, xAxes: [], yAxes: [], zAxes: LEVELS };
const GEVAL = 1;

/**
 * Een portaal 6 m breed en 3 m hoog in y = 0 (kolommen 1 en 2, ligger 3 van
 * knoop 3 naar 4 met een lijnlast van −5 kN/m), en daarachter een vloerplaat
 * op level v1 (y 1,5 … 5,5; 0,25 m dik, middenvlak z = 3 m) met een opening
 * van 1 × 1 m (x 2 … 3, y 3 … 4).
 */
function portaal({ kolom = false, scharnier = false }: { kolom?: boolean; scharnier?: boolean } = {}): OpenFem3DModel {
  const v1 = { levelId: "v1" };
  return parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 },
      { id: 3, x: 0, y: 0, z: 3, ...v1 }, { id: 4, x: 6, y: 0, z: 3, ...v1 },
      { id: 5, x: 0, y: 1.5, z: 3, ...v1 }, { id: 6, x: 6, y: 1.5, z: 3, ...v1 },
      { id: 7, x: 6, y: 5.5, z: 3, ...v1 }, { id: 8, x: 0, y: 5.5, z: 3, ...v1 },
      { id: 9, x: 2, y: 3, z: 3, ...v1 }, { id: 10, x: 3, y: 3, z: 3, ...v1 },
      { id: 11, x: 3, y: 4, z: 3, ...v1 }, { id: 12, x: 2, y: 4, z: 3, ...v1 },
      // Met `kolom`: een kolom onder de vloer, met de kolomkop (knoop 13) in het middenvlak.
      ...(kolom ? [{ id: 13, x: 4.5, y: 3.5, z: 3, ...v1 }, { id: 14, x: 4.5, y: 3.5, z: 0 }] : []),
    ],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235" },
      { id: 2, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S235" },
      // Met `scharnier`: de ligger scharnierend aan knoop 4 (een scharnierbol vlak naast de knoop).
      { id: 3, startNodeId: 3, endNodeId: 4, profileName: "IPE 300", material: "S235",
        ...(scharnier ? { releases: { myStart: false, myEnd: true, mzStart: false, mzEnd: true, torsionStart: false, torsionEnd: false } } : {}) },
      ...(kolom ? [{ id: 4, startNodeId: 14, endNodeId: 13, profileName: "HEA 200", material: "S235" }] : []),
    ],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
      { nodeId: 2, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [],
    memberLoads: [{ id: 1, beamId: 3, caseId: GEVAL, qyStart: 0, qyEnd: 0, qzStart: -5, qzEnd: -5, startPositionM: 0, endPositionM: 6 }],
    memberPointLoads: [], thermalLoads: [],
    plates: [{ id: 1, nodeIds: [5, 6, 7, 8], thicknessM: 0.25, material: "C30/37", levelId: "v1",
      openings: [{ id: 1, nodeIds: [9, 10, 11, 12] }] }],
    surfaceLoads: [],
  });
}

const ZICHT: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY,
  grid: false, axes: false, structuralGrid: false, levelMarks: false, nodeNumbers: false, viewCube: false,
  deformation: false, reactions: false, utilization: false,
};
/** Schuin van voren boven: de ligger vooraan, de vloer erachter. */
const SCHUIN: OpenFem3DCameraState = { position: [-3, -9, 10], target: [3, 2.5, 2], up: [0, 0, 1] };
/** Dicht bij knoop 3, voor de knoopschaal. */
const DICHTBIJ: OpenFem3DCameraState = { position: [-0.5, -4, 4.5], target: [1, 0, 3], up: [0, 0, 1] };
/**
 * Iso van linksvoor boven: ligger 3 loopt van knoop 4 naar de camera toe, en
 * de vloer loopt voor kolomkop 13 naar de camera toe. Naast knoop 4 richting
 * knoop 3 (en naast knoop 13 aan de voorkant) raakt de klikstraal de ligger of
 * de plaat al gauw tientallen centimeters vóór de knoop: de camerazijde.
 */
const ISO: OpenFem3DCameraState = { position: [-8.5, -9, 13], target: [3, 2.5, 1.5], up: [0, 0, 1] };

interface Stand { model: OpenFem3DModel; tool: OpenFem3DTool; selectie: OpenFem3DSelection; wijzigingen: number }
let stand: Stand;
let zet: { tool: (t: OpenFem3DTool) => void; zicht: (v: OpenFem3DVisibility) => void };

function Werkruimte({ begin, camera, zicht = ZICHT }: { begin: OpenFem3DModel; camera: OpenFem3DCameraState; zicht?: OpenFem3DVisibility }) {
  const [model, setModel] = React.useState(begin);
  const [tool, setTool] = React.useState<OpenFem3DTool>("select");
  const [selectie, setSelectie] = React.useState<OpenFem3DSelection>(null);
  const [v, setV] = React.useState(zicht);
  const modelRef = React.useRef(model);
  modelRef.current = model;
  const wijzigingen = React.useRef(0);
  const wijzig = (next: OpenFem3DModel) => { wijzigingen.current += 1; modelRef.current = next; setModel(next); };
  stand = { model, tool, selectie, wijzigingen: wijzigingen.current };
  zet = { tool: setTool, zicht: setV };
  // Dezelfde helper als App.applyOpenFem3DNodeTool: knoop en voorwaarde in één wijziging, de knoop geselecteerd.
  const plaatsVoorwaarde = (target: OpenFem3DNodeTarget) => {
    const placed = openFem3DNodeToolClick(modelRef.current, target, tool);
    if (!placed) return;
    wijzig(placed.model);
    setSelectie({ type: "node", id: placed.nodeId });
  };
  // Zoals App.applyOpenFem3DPointLoadTool: de last in het actieve geval, geselecteerd.
  const plaatsPuntlast = (target: OpenFem3DPointLoadTarget) => {
    const placed = placeOpenFem3DPointLoad(modelRef.current, target, GEVAL);
    wijzig(placed.model);
    setSelectie(placed.selection);
  };
  return (
    <div style={{ display: "flex", width: 1100, height: 620 }}>
      <div style={{ width: 800, height: 620, position: "relative", display: "flex" }}>
        <OpenFem3DEditor model={model} onChange={wijzig} visibility={v} onVisibilityChange={setV}
          tool={tool} onToolChange={setTool} selection={selectie} onSelectionChange={setSelectie}
          onPlaceNodeCondition={plaatsVoorwaarde} onPlacePointLoad={plaatsPuntlast}
          showLoadCase activeLoadCaseId={GEVAL} structuralGrid={GRID} initialCamera={camera} />
      </div>
      <div style={{ width: 300, height: 620, overflow: "auto" }} className="paneel">
        {selectie && <OpenFem3DProperties model={model} selection={selectie} onChange={wijzig} result={null}
          activeLoadCaseId={GEVAL} levels={LEVELS} />}
      </div>
    </div>
  );
}

const tekenvlak = () => container.querySelector<HTMLElement>(".open-fem3d-canvas")!;
const canvas3d = () => container.querySelector<HTMLCanvasElement>(".open-fem3d-canvas canvas")!;
const paneel = () => container.querySelector<HTMLElement>(".paneel")!;

/** Schermpunt (client) van een wereldpunt, met de camera waarmee het tekenvlak tekent. */
function scherm(p: [number, number, number]): { x: number; y: number } {
  ok(renderCamera, "er is getekend");
  renderCamera!.updateMatrixWorld();
  const rect = canvas3d().getBoundingClientRect();
  const n = new THREE.Vector3(...p).project(renderCamera!);
  return { x: rect.left + (n.x + 1) / 2 * rect.width, y: rect.top + (1 - n.y) / 2 * rect.height };
}
/** Een echte klik (aanwijzer bewegen, neer en op dezelfde plek) op het WebGL-canvas. */
function klik(punt: { x: number; y: number }) {
  const canvas = canvas3d();
  const basis = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: punt.x, clientY: punt.y };
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointermove", { ...basis, button: -1, buttons: 0 })));
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointerdown", { ...basis, button: 0, buttons: 1 })));
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointerup", { ...basis, button: 0, buttons: 0 })));
}
/** `d` pixels van punt a in de richting van punt b (op het scherm). */
function naast(a: { x: number; y: number }, b: { x: number; y: number }, d: number) {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + d * (b.x - a.x) / l, y: a.y + d * (b.y - a.y) / l };
}
async function begin(model: OpenFem3DModel, camera: OpenFem3DCameraState, tool: OpenFem3DTool, zicht = ZICHT) {
  mount(<Werkruimte begin={model} camera={camera} zicht={zicht} />);
  await wacht(300);
  flushSync(() => zet.tool(tool));
  await wacht(80);
}
/** De getekende straal van de knoopbol van knoop `id` in schermpixels (de zichtbare knoopbatch in de scène). */
function bolStraalPx(id: number, plek: [number, number, number]): number {
  let straal = 0;
  renderScene!.traverse((o) => {
    if (o.userData.openFem3dNodeVisual !== true) return;
    const batch = o as THREE.InstancedMesh;
    const index = (o.userData.instanceIndexById as Map<number, number> | undefined)?.get(id);
    if (index === undefined) return;
    batch.geometry.computeBoundingSphere();
    const instantie = new THREE.Matrix4();
    batch.getMatrixAt(index, instantie);
    o.updateWorldMatrix(true, false);
    straal = batch.geometry.boundingSphere!.radius * new THREE.Vector3().setFromMatrixScale(instantie).x
      * new THREE.Vector3().setFromMatrixScale(o.matrixWorld).x;
  });
  ok(straal > 0, `knoopbol van knoop ${id} gevonden`);
  const rechts = new THREE.Vector3().setFromMatrixColumn(renderCamera!.matrixWorld, 0).normalize().multiplyScalar(straal);
  const midden = scherm(plek), rand = scherm([plek[0] + rechts.x, plek[1] + rechts.y, plek[2] + rechts.z]);
  return Math.hypot(rand.x - midden.x, rand.y - midden.y);
}
/** De punten van de elementlijnen van het getekende rekennet (weergave Mesh). */
function meshPunten(): THREE.Vector3[] {
  const laag = renderScene!.getObjectByName("open-fem3d-plate-overlay");
  const uit: THREE.Vector3[] = [];
  for (const lijnen of (laag?.children ?? []).filter((c) => c.userData.openFem3dPlateMesh !== undefined) as THREE.LineSegments[]) {
    lijnen.updateWorldMatrix(true, false);
    const pos = lijnen.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) uit.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(lijnen.matrixWorld));
  }
  return uit;
}
/** Afstand (m) van de camera tot een wereldpunt, zoals de raycast in perspectief meet. */
function cameraAfstand(p: [number, number, number]): number {
  return new THREE.Vector3().setFromMatrixPosition(renderCamera!.matrixWorld).distanceTo(new THREE.Vector3(...p));
}
/** Hoeveel (m) vóór punt p de klikstraal de eerste staaf of plaat raakte; NaN zonder treffer. */
function voorsprong(soort: "beam" | "plate", p: [number, number, number]): number {
  const treffer = (tekenvlak().dataset.openFem3dPickCandidates ?? "").split(",").find((c) => c.startsWith(`${soort}@`));
  return treffer ? cameraAfstand(p) - Number(treffer.slice(soort.length + 1)) : Number.NaN;
}
type Punt = [number, number, number];
/** In een vers model: een klik `d` px naast `knoop` (scherm) richting `naar`, met gereedschap `tool`. */
async function klikNaast(model: OpenFem3DModel, camera: OpenFem3DCameraState, tool: OpenFem3DTool,
  knoop: Punt, naar: Punt, d: number, soort: "beam" | "plate") {
  await begin(model, camera, tool);
  klik(naast(scherm(knoop), scherm(naar), d));
  await wacht();
  return { plaatsing: tekenvlak().dataset.openFem3dPlacement, voorsprong: voorsprong(soort, knoop) };
}
const K3: Punt = [0, 0, 3], K4: Punt = [6, 0, 3], K13: Punt = [4.5, 3.5, 3];
/** Recht van boven op de kolom: de straal naar kolomvoet 14 gaat door de vloerplaat. */
const BOVEN: OpenFem3DCameraState = { position: [4.5, 0, 14], target: [4.5, 3.5, 0], up: [0, 0, 1] };

const melding = () => container.querySelector<HTMLElement>(".open-fem3d-draw-error")?.textContent ?? "";
const kop = () => container.querySelector<HTMLElement>(".open-fem3d-stage-header > span")?.textContent ?? "";

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  document.documentElement.setAttribute("data-oa-theme", "light");
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("oplegging: een klik op de ligger 9 px naast knoop 3 → de oplegging op knoop 3, de ligger blijft heel", async () => {
    await begin(portaal(), SCHUIN, "support:pinned");
    ok(kop() === i18next.t("ribbon:openFem3d.supportPlacementHelp"), `hulptekst in de kop: ${kop()}`);
    const klikpunt = naast(scherm([0, 0, 3]), scherm([3, 0, 3]), 9);
    klik(klikpunt);
    await wacht();
    gelijk(tekenvlak().dataset.openFem3dPickType, "beam", "zonder de snapzone was dit de ligger");
    gelijk(tekenvlak().dataset.openFem3dPlacement, "node:3", "plaatsing");
    gelijk([stand.model.nodes.length, stand.model.beams.length], [12, 3], "geen nieuwe knoop, geen splitsing");
    const steun = stand.model.supports?.find((s) => s.nodeId === 3);
    ok(steun && steun.uz && !steun.rx, `scharnier op knoop 3: ${JSON.stringify(steun)}`);
    gelijk([stand.wijzigingen, stand.selectie], [1, { type: "node", id: 3 }], "één wijziging, knoop geselecteerd");
  });

  // De camerazijde: de ligger loopt naar de camera toe, dus de klikstraal
  // raakt hem naast knoop 4 al gauw ruim vóór de knoop. De knoop is op zijn
  // eigen schermpunt gewoon zichtbaar en moet de oplegging krijgen (spec 1).
  await test("camerazijde, iso: een klik op de ligger 4–12 px naast knoop 4 richting knoop 3 → de oplegging op knoop 4, geen splitsing", async () => {
    const gezien: string[] = [];
    let grootste = 0;
    for (const d of [4, 6, 8, 10, 12]) {
      const r = await klikNaast(portaal(), ISO, "support:pinned", K4, K3, d, "beam");
      gelijk(r.plaatsing, "node:4", `iso, ${d} px`);
      gelijk([stand.model.nodes.length, stand.model.beams.length, stand.wijzigingen], [12, 3, 1], `${d} px: geen nieuwe knoop, geen splitsing, één wijziging`);
      ok(stand.model.supports?.some((s) => s.nodeId === 4 && s.uz && !s.rx), `${d} px: scharnier op knoop 4`);
      grootste = Math.max(grootste, r.voorsprong);
      gezien.push(`${d} px: ${r.voorsprong.toFixed(3)}`);
    }
    // Anders bewaakt de proef niets: de klikstraal raakte de ligger verder
    // vóór de knoop dan de marge (0,1 m) plus de knoopstraal.
    ok(grootste > 0.25, `de klikstraal raakte de ligger ruim vóór knoop 4 (${gezien.join("; ")})`);
    info.push(`iso naast knoop 4, ligger vóór de knoop (m): ${gezien.join("; ")}`);
  });

  await test("camerazijde, schuin: 10 en 12 px naast knoop 4 richting knoop 3 → knoop 4", async () => {
    for (const d of [10, 12]) {
      const r = await klikNaast(portaal(), SCHUIN, "support:pinned", K4, K3, d, "beam");
      gelijk(r.plaatsing, "node:4", `schuin, ${d} px (ligger ${r.voorsprong.toFixed(3)} m vóór de knoop)`);
      gelijk([stand.model.nodes.length, stand.model.beams.length], [12, 3], `${d} px: niet gesplitst`);
    }
  });

  await test("camerazijde met een scharnier aan het eind van de ligger (bol naast knoop 4): 4, 8 en 12 px → knoop 4", async () => {
    for (const d of [4, 8, 12]) {
      const r = await klikNaast(portaal({ scharnier: true }), ISO, "support:pinned", K4, K3, d, "beam");
      ok(Number(tekenvlak().dataset.openFem3dBeamHinges) >= 1, "de scharnierbol staat in beeld");
      gelijk(r.plaatsing, "node:4", `scharnier, ${d} px`);
      gelijk([stand.model.nodes.length, stand.model.beams.length], [12, 3], `${d} px: niet gesplitst`);
    }
  });

  await test("camerazijde, veer kz: 12 px naast knoop 4 → de veer op knoop 4, niet gesplitst", async () => {
    const r = await klikNaast(portaal(), ISO, "spring:kz", K4, K3, 12, "beam");
    gelijk(r.plaatsing, "node:4", "veer");
    const veer = stand.model.supports?.find((s) => s.nodeId === 4);
    ok(veer?.springs?.kzKnPerM && !veer.uz, `Z-veer op knoop 4: ${JSON.stringify(veer)}`);
    gelijk([stand.model.nodes.length, stand.model.beams.length, stand.wijzigingen], [12, 3, 1], "niet gesplitst, één wijziging");
  });

  await test("camerazijde, puntlast: 8 px naast knoop 4 → een knooplast op knoop 4, geen staafpuntlast", async () => {
    const r = await klikNaast(portaal(), ISO, "addPointLoad", K4, K3, 8, "beam");
    gelijk([r.plaatsing, tekenvlak().dataset.openFem3dPointLoad], ["node:4", "node"], "op de knoop");
    gelijk([stand.model.loads?.at(-1)?.nodeId, stand.model.loads?.at(-1)?.fz, stand.model.memberPointLoads?.length ?? 0], [4, -10, 0], "knooplast");
    gelijk(stand.wijzigingen, 1, "één wijziging");
  });

  await test("camerazijde van een plaatknoop: 6–12 px naast kolomkop 13 op de vloer (naar voren) → knoop 13, geen nieuwe plaatknoop", async () => {
    const gezien: string[] = [];
    let grootste = 0;
    for (const d of [6, 8, 10, 12]) {
      const r = await klikNaast(portaal({ kolom: true }), ISO, "support:pinned", K13, [4.2, 2.5, 3], d, "plate");
      gelijk(r.plaatsing, "node:13", `iso, ${d} px`);
      gelijk([stand.model.nodes.length, stand.model.beams.length, stand.wijzigingen], [14, 4, 1], `${d} px: geen nieuwe knoop, één wijziging`);
      ok(stand.model.supports?.some((s) => s.nodeId === 13 && s.uz), `${d} px: oplegging op knoop 13`);
      grootste = Math.max(grootste, r.voorsprong);
      gezien.push(`${d} px: ${r.voorsprong.toFixed(3)}`);
    }
    // De plaatband is 0,125 + 0,25 m; de klikstraal raakte de plaat verder vóór de knoop.
    ok(grootste > 0.45, `de klikstraal raakte de plaat ruim vóór knoop 13 (${gezien.join("; ")})`);
    info.push(`iso naast knoop 13, plaat vóór de knoop (m): ${gezien.join("; ")}`);
  });

  await test("een knoop onder de vloer (kolomvoet 14, door de plaat heen) telt niet: de oplegging komt op de plaat", async () => {
    await begin(portaal({ kolom: true }), BOVEN, "support:pinned");
    klik(scherm([4.5, 3.5, 0]));
    await wacht();
    gelijk(tekenvlak().dataset.openFem3dPlacementNodeDistancePx !== "none", true, "knoop 14 ligt binnen de snapzone");
    gelijk(tekenvlak().dataset.openFem3dPlacement, "plate:1", "plaatsing");
    const knoop = stand.model.nodes.find((n) => n.id === 15);
    ok(knoop && knoop.z === 3 && knoop.levelId === "v1", `nieuwe plaatknoop 15 in het middenvlak: ${JSON.stringify(knoop)}`);
    ok(!stand.model.supports?.some((s) => s.nodeId === 14), "kolomvoet 14 kreeg niets");
  });

  await test("oplegging: midden op de ligger (x = 2,5 m) → gesplitst op 2500 mm, nieuwe knoop met de oplegging, één wijziging", async () => {
    await begin(portaal(), SCHUIN, "support:fixed");
    klik(scherm([2.5, 0, 3]));
    await wacht();
    gelijk(tekenvlak().dataset.openFem3dPlacement, "beam:3", "plaatsing");
    const knoop = stand.model.nodes.find((n) => n.id === 13);
    ok(knoop, "nieuwe knoop 13");
    ongeveer(knoop!.x, 2.5, 0.0015, "x van de nieuwe knoop");
    gelijk([knoop!.y, knoop!.z, knoop!.levelId], [0, 3, "v1"], "op de ligger en op level v1");
    ok(Math.abs(knoop!.x * 1000 - Math.round(knoop!.x * 1000)) < 1e-6, `hele mm: ${knoop!.x}`);
    gelijk(stand.model.beams.map((b) => [b.id, b.startNodeId, b.endNodeId]), [[1, 1, 3], [2, 2, 4], [3, 3, 13], [4, 13, 4]], "ligger in twee delen");
    const steun = stand.model.supports?.find((s) => s.nodeId === 13);
    ok(steun && steun.ux && steun.rz, `inklemming op knoop 13: ${JSON.stringify(steun)}`);
    gelijk(stand.model.memberLoads?.map((l) => [l.beamId, l.qzStart]), [[3, -5], [4, -5]], "lijnlast op beide delen");
    ongeveer(stand.model.memberLoads!.reduce((s, l) => s + l.endPositionM - l.startPositionM, 0), 6, 1e-9, "samen weer 6 m last");
    gelijk([stand.wijzigingen, stand.selectie], [1, { type: "node", id: 13 }], "één wijziging (één stap ongedaan maken), knoop geselecteerd");
    info.push(`ligger gesplitst op x = ${knoop!.x} m`);
  });

  await test("knoopschaal 400 %: een klik op de vergrote bol buiten 14 px kiest knoop 3; bij 100 % is dezelfde plek de ligger", async () => {
    await begin(portaal(), DICHTBIJ, "support:pinned", { ...ZICHT, nodeSizePercent: 400 });
    const r400 = bolStraalPx(3, [0, 0, 3]);
    const d = Math.min(r400 - 3, 30);
    ok(d > 16, `de bol bij 400 % is groot genoeg voor de proef: straal ${r400.toFixed(1)} px`);
    const klikpunt = naast(scherm([0, 0, 3]), scherm([3, 0, 3]), d);
    klik(klikpunt);
    await wacht();
    gelijk(tekenvlak().dataset.openFem3dPlacement, "node:3", `400 %, ${d.toFixed(1)} px naast het midden`);
    await begin(portaal(), DICHTBIJ, "support:pinned", { ...ZICHT, nodeSizePercent: 100 });
    const r100 = bolStraalPx(3, [0, 0, 3]);
    ok(r100 + 1 < d && d > 14, `bij 100 % ligt de klik buiten de bol (${r100.toFixed(1)} px) en de snapzone`);
    klik(naast(scherm([0, 0, 3]), scherm([3, 0, 3]), d));
    await wacht();
    gelijk(tekenvlak().dataset.openFem3dPlacement, "beam:3", "100 %: de ligger");
    gelijk(stand.model.beams.length, 4, "en die is gesplitst");
    info.push(`knoopbol ${r100.toFixed(1)} px (100 %) en ${r400.toFixed(1)} px (400 %); klik op ${d.toFixed(1)} px`);
  });

  await test("oplegging op de vloerplaat → nieuwe knoop in het middenvlak (z = 3 m) op level v1; het getekende rekennet heeft er een hoekpunt", async () => {
    await begin(portaal(), SCHUIN, "support:pinned", { ...ZICHT, plateDisplay: "mesh" });
    await wacht(600);
    const voor = meshPunten();
    ok(voor.length > 0, "het rekennet staat in beeld (weergave Mesh)");
    // Op de bovenkant van de 0,25 m dikke plaat is in weergave Mesh het middenvlak zelf.
    klik(scherm([4.25, 4.75, 3]));
    await wacht();
    gelijk(tekenvlak().dataset.openFem3dPlacement, "plate:1", "plaatsing");
    const knoop = stand.model.nodes.find((n) => n.id === 13);
    ok(knoop, "nieuwe knoop 13");
    gelijk([knoop!.z, knoop!.levelId], [3, "v1"], "middenvlak en level");
    ongeveer(knoop!.x, 4.25, 0.02, "x"); ongeveer(knoop!.y, 4.75, 0.02, "y");
    gelijk([stand.model.beams.length, JSON.stringify(stand.model.plates)], [3, JSON.stringify(portaal().plates)], "geen staaf of plaat gewijzigd");
    ok(stand.model.supports?.some((s) => s.nodeId === 13 && s.uz), "oplegging op de nieuwe knoop");
    gelijk(stand.wijzigingen, 1, "één wijziging");
    const plek = new THREE.Vector3(knoop!.x, knoop!.y, knoop!.z);
    ok(!voor.some((p) => p.distanceTo(plek) < 1e-4), "vóór de plaatsing geen hoekpunt op die plek");
    await wacht(900);
    const na = meshPunten();
    ok(na.some((p) => p.distanceTo(plek) < 1e-4), `het rekennet is opnieuw gemaakt met een hoekpunt op de nieuwe knoop (${na.length / 2} lijnstukken)`);
    info.push(`plaatknoop op (${knoop!.x}; ${knoop!.y}; ${knoop!.z}); rekennet ${voor.length / 2} → ${na.length / 2} lijnstukken`);
  });

  await test("in de opening van de plaat: geen knoop in de plaat (de klik gaat door naar het werkvlak eronder)", async () => {
    await begin(portaal(), SCHUIN, "support:pinned");
    klik(scherm([2.5, 3.5, 3]));
    await wacht();
    gelijk(tekenvlak().dataset.openFem3dPlacement, "none", "geen knoop, staaf of plaat onder de cursor");
    ok(!stand.model.nodes.some((n) => n.z === 3 && n.x > 2 && n.x < 3 && n.y > 3 && n.y < 4), "geen knoop in de opening");
  });

  await test("veer op de ligger: gesplitst, nieuwe knoop met de Z-veer", async () => {
    await begin(portaal(), SCHUIN, "spring:kz");
    ok(kop() === i18next.t("ribbon:openFem3d.springPlacementHelp"), "hulptekst bij de veer");
    klik(scherm([4, 0, 3]));
    await wacht();
    const knoop = stand.model.nodes.find((n) => n.id === 13);
    ok(knoop && Math.abs(knoop.x - 4) < 0.0015, `nieuwe knoop op x = 4 m: ${JSON.stringify(knoop)}`);
    const veer = stand.model.supports?.find((s) => s.nodeId === 13);
    ok(veer?.springs?.kzKnPerM && !veer.uz, `Z-veer: ${JSON.stringify(veer)}`);
    gelijk([stand.model.beams.length, stand.wijzigingen], [4, 1], "gesplitst, één wijziging");
  });

  await test("puntlast op knoop 4: knooplast Fz = −10 kN in het actieve geval; het paneel toont hem geselecteerd", async () => {
    await begin(portaal(), SCHUIN, "addPointLoad");
    ok(kop() === i18next.t("ribbon:openFem3d.pointLoadPlacementHelp"), `hulptekst in de kop: ${kop()}`);
    ok(tekenvlak().className.includes("open-fem3d-tool-support"), "kruisdraadcursor");
    klik(naast(scherm([6, 0, 3]), scherm([3, 0, 3]), 6));
    await wacht(150);
    gelijk(tekenvlak().dataset.openFem3dPointLoad, "node", "op de knoop");
    const last = stand.model.loads?.at(-1);
    gelijk([last?.nodeId, last?.fz, last?.fx, last?.caseId], [4, -10, 0, GEVAL], "knooplast");
    gelijk([stand.selectie, stand.wijzigingen, stand.model.nodes.length], [{ type: "nodalLoad", id: last!.id }, 1, 12], "geselecteerd, één wijziging");
    ok(paneel().querySelector(".open-fem3d-condition-load-list .selected")?.textContent?.includes(`#${last!.id}`), "de last staat geselecteerd in het paneel");
    const fz = paneel().querySelector<HTMLInputElement>('input[aria-label="FZ"]');
    gelijk(fz?.value, "-10", "Fz in het formulier");
  });

  await test("puntlast op de ligger bij x = 4 m: staafpuntlast op 4000 mm, de ligger blijft heel; het paneel staat op Puntlast met die plek", async () => {
    await begin(portaal(), SCHUIN, "addPointLoad");
    klik(scherm([4, 0, 3]));
    await wacht(150);
    gelijk(tekenvlak().dataset.openFem3dPointLoad, "beam", "op de staaf");
    const last = stand.model.memberPointLoads?.at(-1);
    ok(last, "staafpuntlast");
    gelijk([last!.beamId, last!.pz, last!.py, last!.caseId], [3, -10, 0, GEVAL], "Pz −10 kN in geval 1 op ligger 3");
    ongeveer(last!.positionM, 4, 0.0015, "plek langs de ligger");
    ok(Math.abs(last!.positionM * 1000 - Math.round(last!.positionM * 1000)) < 1e-6, "hele mm");
    gelijk([stand.model.beams.length, stand.model.nodes.length, stand.wijzigingen], [3, 12, 1], "niet gesplitst, één wijziging");
    gelijk(stand.selectie, { type: "memberPointLoad", id: last!.id }, "geselecteerd");
    const tab = [...paneel().querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.getAttribute("aria-selected") === "true");
    gelijk(tab?.textContent, i18next.t("ribbon:openFem3d.memberLoads.tabPoint"), "tab Puntlast");
    const plek = [...paneel().querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')].map((i) => i.value);
    ok(plek.includes(String(Math.round(last!.positionM * 1000))), `plek in mm in het formulier: ${plek.join(", ")}`);
    info.push(`staafpuntlast op ${last!.positionM} m`);
  });

  await test("puntlast op de plaat of in leeg canvas: niets, met een melding; Esc stopt het gereedschap", async () => {
    await begin(portaal(), SCHUIN, "addPointLoad");
    const model = stand.model;
    klik(scherm([4.5, 2.5, 3]));
    await wacht();
    gelijk(tekenvlak().dataset.openFem3dPointLoad, "plate", "op de plaat");
    ok(stand.model === model && stand.wijzigingen === 0, "het model bleef gelijk");
    gelijk(melding().replace("×", "").trim(), i18next.t("ribbon:openFem3d.pointLoadPlacementMissed"), "melding");
    const rect = canvas3d().getBoundingClientRect();
    klik({ x: rect.left + 20, y: rect.top + 20 });
    await wacht();
    gelijk(tekenvlak().dataset.openFem3dPointLoad, "none", "leeg canvas");
    ok(stand.model === model, "nog steeds gelijk");
    flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await wacht();
    gelijk(stand.tool, "select", "Esc → Selecteren");
  });

  await test("lint: Puntlast zonder selectie zet het gereedschap aan; met een knoop of staaf het formulier zoals voorheen", async () => {
    const geroepen: string[] = [];
    const lint = (props: Record<string, unknown>) => {
      mount(<div className="ribbon-container"><HomeTab modelDimension="3d"
        onOpenFem3DToolChange={(t: OpenFem3DTool) => geroepen.push(`tool:${t}`)}
        onOpenFem3DRequestNodalLoad={(k: string) => geroepen.push(`knooplast:${k}`)}
        onOpenFem3DRequestMemberPointLoad={() => geroepen.push("staafpuntlast")} {...props} /></div>);
      return [...container.querySelectorAll<HTMLButtonElement>("button.ribbon-btn")]
        .find((b) => b.querySelector(".ribbon-btn-label")?.textContent === i18next.t("ribbon:home.pointLoad"))!;
    };
    let knop = lint({});
    ok(knop && !knop.disabled, "zonder selectie bruikbaar");
    gelijk(lintUitleg(knop), i18next.t("ribbon:openFem3d.pointLoadPlacementHelp"), "uitleg bij de knop");
    knop.click();
    knop = lint({ openFem3dTool: "addPointLoad" });
    ok(knop.className.includes("active"), "actief met het gereedschap aan");
    lint({ hasOpenFem3DNodeSelection: true }).click();
    lint({ hasOpenFem3DBeamSelection: true }).click();
    gelijk(geroepen, ["tool:addPointLoad", "knooplast:force", "staafpuntlast"], "aanroepen");
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven): de toestand na de plaatsing. */
async function toonBeeld(beeld: string) {
  if (beeld === "plaat-oplegging") {
    // Dichter bij de vloer: het net rond de nieuwe knoop is goed te zien.
    const camera: OpenFem3DCameraState = { position: [0.5, -2.5, 8.5], target: [3.5, 3.5, 2.5], up: [0, 0, 1] };
    await begin(portaal(), camera, "support:pinned", { ...ZICHT, plateDisplay: "mesh", nodeNumbers: true });
    await wacht(600);
    klik(scherm([4.25, 4.75, 3]));
    await wacht(1200);
    return;
  }
  if (beeld === "puntlast-staaf") {
    // Zonder de lijnlast, zodat de nieuwe puntlast (geselecteerd) opvalt; het
    // paneel op het formulier van de staafpuntlast.
    const camera: OpenFem3DCameraState = { position: [1, -8, 6.5], target: [3, 1, 2], up: [0, 0, 1] };
    await begin({ ...portaal(), memberLoads: [] }, camera, "addPointLoad", { ...ZICHT, nodeNumbers: true });
    klik(scherm([4, 0, 3]));
    await wacht(400);
    paneel().querySelector(".open-fem3d-member-loads")?.scrollIntoView();
    await wacht(100);
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, info, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, info, error: String(e?.stack ?? e) }); });
