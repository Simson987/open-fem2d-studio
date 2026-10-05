/**
 * Browserkant van test-open-fem3d-tekenhulp-ui.mjs: de tekenhulpen van #84 in
 * de echte 3D-werkruimte (OpenFem3DEditor met ThreeFrameCanvas, WebGL), met
 * de echte statusbalk (snapknopjes van 3D) en de echte tab Weergave, en met
 * echte muis- en toetsgebeurtenissen op het tekenvlak. Bovenaanzicht, werkvlak
 * peil 0, raster 500 mm. De rekenregels zelf: test-open-fem3d-tekenhulp.mjs.
 *
 * Model: knoop 1 (0; 0,2), knoop 2 (6; 0,2), knoop 3 (6; 4,2) en staaf 1 van
 * knoop 1 naar knoop 2. De y-maten liggen bewust naast het raster: een punt op
 * y = 4,2 of 0,2 komt alleen van het objectspoor, het raster gaf 4,0 of 0,0.
 *
 * Bewaakt:
 *  - uitlijnen: knoop 3 verworven (de muis 0,4 s erboven), dan een staaf van
 *    knoop 1 naar (2; 4,2): de spoorlijn in beeld, de tekst 'uitlijnen X met
 *    knoop 3', het maatlabel met lengte en richting; het eindpunt exact; ook
 *    in een scheef perspectief (werkvlak peil 0), daar ook 7,5 px loodrecht
 *    in beeld naast de spoorlijn;
 *  - Alt (bij de klik en ook zonder muisbeweging) zet alle snaps uit, ook de
 *    knoopsnap (5 px naast knoop 3);
 *  - het objectspoor uit met het knopje in de statusbalk: niets verworven, 3 px
 *    naast de Y-lijn door het beginpunt geen spoor maar het raster; weer aan in
 *    de tab Weergave;
 *  - verlengen: staaf 1 verworven, een staaf van knoop 3 naar (8; 0,2);
 *  - directe invoer: 4500 mm typen (met komma, Backspace) en Enter, langs Y;
 *    Esc wist eerst alleen de getypte maat, de tweede Esc stopt het gereedschap;
 *    een muisklik laat de getypte maat vervallen (zoals in 2D);
 *  - aansluiten op een staaf: de klik 1 px naast staaf 1 en 3 px naast de
 *    spoor- of ortholijn splitst staaf 1 op het snijpunt van die lijn met de
 *    staaf, niet op het muispunt en niet met een losse knoop ernaast (raster
 *    aan, raster uit, Shift); het voetpunt 'loodrecht op staaf 1' splitst staaf
 *    1, ook 6 px naast de staaf;
 *  - een grote hal (972 knopen, 2484 staven): zeven items verworven, het spoor
 *    werkt en het eindpunt ligt exact; de tijd per muisstand meet
 *    test-open-fem3d-tekenhulp.mjs [13], want met virtuele tijd staat de klok
 *    hier stil. (Daar ligt het spoorpunt langs de staaf onder de muis; dat
 *    splitsen op het snijpunt en niet op het muispunt gebeurt, toetst
 *    'aansluiten'.);
 *  - Shift: ortho langs Y;
 *  - plaatomtrek: na het eerste hoekpunt 4500 mm intypen en Enter, dan Shift;
 *  - voorrang: het spoor gaat voor het stramien (stramienas op x = 2,1 m);
 *  - verwerven: een knoop tot 10 px, een staaf tot 6 px;
 *  - het maatlabel overlapt de tekst bij de cursor niet, ook bij een korte staaf.
 *
 * `#beeld=spoor` en `#beeld=schakelaars` tonen alleen een beeld voor een
 * schermafbeelding. De uitslag komt als JSON in #uitslag.
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
import "../src/themes.css";
import "../src/App.css";
import "../src/components/fem/FemProjectTree.css";
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import StatusBar from "../src/components/StatusBar";
import ExplorerViewTab from "../src/components/fem/ExplorerViewTab";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { herstelSnapBeginstand, leesSnapInstellingen, SNAP_SCHAKELAARS_3D, zetSnap } from "../src/hooks/useSnapInstellingen";
import type { StructuralGrid } from "../src/components/fem/femTypes";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DTool } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};
// Headless met virtuele tijd tekent geen beeldjes: het voorbeeld onder de muis
// (één per animatieframe) loopt dan via een gewone timer (zoals in
// mm-invoer-browser.tsx).
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);

// De camera en scène waarmee het tekenvlak echt tekent (zoals in open-fem3d-plaatsen-browser.tsx).
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
  herstelSnapBeginstand();
}

/* ── Model en werkruimte ──────────────────────────────────────────────── */

type Punt = [number, number, number];
const K1: Punt = [0, 0.2, 0], K2: Punt = [6, 0.2, 0], K3: Punt = [6, 4.2, 0];
function model(): OpenFem3DModel {
  return parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0.2, z: 0 }, { id: 2, x: 6, y: 0.2, z: 0 }, { id: 3, x: 6, y: 4.2, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 200", material: "S235" }],
    supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
  });
}
/** Een model met alleen knopen en staven (de rest leeg). */
function kaal(nodes: { id: number; x: number; y: number; z: number }[], beams: [number, number, number][]): OpenFem3DModel {
  return parseOpenFem3DModel({
    nodes, beams: beams.map(([id, startNodeId, endNodeId]) => ({ id, startNodeId, endNodeId, profileName: "IPE 200", material: "S235" })),
    supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
  });
}
/** Staaf 1 langs Y op x = 4,25 m (buiten het raster van 500 mm), knoop 3 op (0; 1,3). */
const modelDoel = () => kaal([{ id: 1, x: 4.25, y: 0, z: 0 }, { id: 2, x: 4.25, y: 3, z: 0 }, { id: 3, x: 0, y: 1.3, z: 0 }], [[1, 1, 2]]);
/** Staaf 1 langs X van (0; 0) naar (6; 0), knoop 3 op (2,3; 3,7). */
const modelVoet = () => kaal([{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 2.3, y: 3.7, z: 0 }], [[1, 1, 2]]);
/** Eén stramienas in X op 2100 mm (buiten het raster), peil 0. */
const STRAMIEN: StructuralGrid = {
  enabled: true, xAxes: [{ id: "A", label: "A", position: 2100 }], yAxes: [], zAxes: [{ id: "1", label: "1", position: 0 }],
};
/**
 * Een hal voor de prestatieproef: drie lagen (z = 0, 4 en 8 m) van 18 × 18
 * knopen op 2 m (972 knopen), liggers in X en Y per laag en kolommen ertussen
 * (2484 staven), van de omvang van een stalen hal.
 */
function hal(): OpenFem3DModel {
  const nodes: { id: number; x: number; y: number; z: number }[] = [];
  const beams: { id: number; startNodeId: number; endNodeId: number; profileName: string; material: string }[] = [];
  const id = (i: number, j: number, laag: number) => 1 + laag * 324 + j * 18 + i;
  for (let laag = 0; laag < 3; laag += 1) for (let j = 0; j < 18; j += 1) for (let i = 0; i < 18; i += 1) {
    nodes.push({ id: id(i, j, laag), x: 2 * i, y: 2 * j, z: 4 * laag });
  }
  const staaf = (a: number, b: number) => beams.push({ id: beams.length + 1, startNodeId: a, endNodeId: b, profileName: "HEA 200", material: "S235" });
  for (let laag = 0; laag < 3; laag += 1) for (let j = 0; j < 18; j += 1) for (let i = 0; i < 18; i += 1) {
    if (i < 17) staaf(id(i, j, laag), id(i + 1, j, laag));
    if (j < 17) staaf(id(i, j, laag), id(i, j + 1, laag));
    if (laag < 2) staaf(id(i, j, laag), id(i, j, laag + 1));
  }
  return parseOpenFem3DModel({
    nodes, beams, supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
  });
}
const ZICHT: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY,
  axes: false, structuralGrid: false, levelMarks: false, viewCube: false,
  deformation: false, reactions: false, utilization: false,
};
/** Recht van boven op peil 0: x naar rechts, y naar boven in beeld. */
const BOVEN: OpenFem3DCameraState = { position: [3.5, 2.2, 14], target: [3.5, 2.2, 0], up: [0, 1, 0] };

interface Stand { model: OpenFem3DModel; tool: OpenFem3DTool; selectie: OpenFem3DSelection }
let stand: Stand;
let zet: { tool: (t: OpenFem3DTool) => void };

function Werkruimte({ begin, zicht = ZICHT, verkenner = false, camera = BOVEN, stramien }: {
  begin: OpenFem3DModel; zicht?: OpenFem3DVisibility; verkenner?: boolean; camera?: OpenFem3DCameraState; stramien?: StructuralGrid;
}) {
  const [m, setM] = React.useState(begin);
  const [tool, setTool] = React.useState<OpenFem3DTool>("select");
  const [selectie, setSelectie] = React.useState<OpenFem3DSelection>(null);
  const [v, setV] = React.useState(zicht);
  stand = { model: m, tool, selectie };
  zet = { tool: setTool };
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1100, height: 640 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 820, height: 600, position: "relative", display: "flex" }}>
          <OpenFem3DEditor model={m} onChange={setM} visibility={v} onVisibilityChange={setV}
            tool={tool} onToolChange={setTool} selection={selectie} onSelectionChange={setSelectie}
            showLoadCase={false} initialCamera={camera} structuralGrid={stramien} />
        </div>
        {verkenner && (
          <div style={{ width: 280, height: 600, overflow: "auto" }} className="verkenner">
            <ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} workspace="3d"
              gridShow setGridShow={() => {}} stramienAan={false} setStramienAan={() => {}}
              openFem3dVisibility={v} setOpenFem3DVisibility={setV} />
          </div>
        )}
      </div>
      <StatusBar nodeCount={m.nodes.length} beamCount={m.beams.length} toonSnap snapSchakelaars={SNAP_SCHAKELAARS_3D} />
    </div>
  );
}

const tekenvlak = () => container.querySelector<HTMLElement>(".open-fem3d-canvas")!;
const canvas3d = () => container.querySelector<HTMLCanvasElement>(".open-fem3d-canvas canvas")!;
const hint = () => container.querySelector<HTMLElement>(".open-fem3d-snap-hint");
const maatLabel = () => container.querySelector<HTMLElement>(".open-fem3d-maat-label");

/** Schermpunt (client) van een wereldpunt, met de camera waarmee het tekenvlak tekent. */
function scherm(p: Punt): { x: number; y: number } {
  ok(renderCamera, "er is getekend");
  renderCamera!.updateMatrixWorld();
  const rect = canvas3d().getBoundingClientRect();
  const n = new THREE.Vector3(...p).project(renderCamera!);
  return { x: rect.left + (n.x + 1) / 2 * rect.width, y: rect.top + (1 - n.y) / 2 * rect.height };
}
/** Pixels per meter in beeld (bovenaanzicht, op peil 0). */
function pxPerMeter(): number {
  const a = scherm([0, 0, 0]), b = scherm([1, 0, 0]);
  return Math.hypot(b.x - a.x, b.y - a.y);
}
type Toetsen = { alt?: boolean; shift?: boolean };
function wijzer(type: string, punt: { x: number; y: number }, toetsen: Toetsen = {}, knop = -1, knoppen = 0) {
  const canvas = canvas3d();
  flushSync(() => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true,
    clientX: punt.x, clientY: punt.y, button: knop, buttons: knoppen,
    altKey: !!toetsen.alt, shiftKey: !!toetsen.shift,
  })));
}
/** De muis naar dit punt; het voorbeeld tekent in het volgende beeldje. */
async function wijs(punt: { x: number; y: number }, toetsen: Toetsen = {}) {
  wijzer("pointermove", punt, toetsen);
  await wacht(60);
}
/** De muis stil boven dit punt tot het verworven is (0,4 s, ruim). */
async function hang(punt: { x: number; y: number }) {
  await wijs(punt);
  await wacht(650);
}
/** Een echte klik: bewegen, neer en op dezelfde plek. */
async function klik(punt: { x: number; y: number }, toetsen: Toetsen = {}) {
  wijzer("pointermove", punt, toetsen);
  wijzer("pointerdown", punt, toetsen, 0, 1);
  wijzer("pointerup", punt, toetsen, 0, 0);
  await wacht(80);
}
function toets(key: string, type: "keydown" | "keyup" = "keydown", extra: KeyboardEventInit = {}) {
  flushSync(() => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...extra })));
}
async function begin(zicht = ZICHT, verkenner = false, m = model(), tool: OpenFem3DTool = "addBeam", stramien?: StructuralGrid) {
  mount(<Werkruimte begin={m} zicht={zicht} verkenner={verkenner} stramien={stramien} />);
  await wacht(300);
  flushSync(() => zet.tool(tool));
  await wacht(80);
}
const staven = () => stand.model.beams.map((b) => [b.id, b.startNodeId, b.endNodeId]);
const verworvenLijst = () => tekenvlak().dataset.openFem3dSpoorVerworven ?? "";
/** `d` pixels naast een wereldpunt (schermrichting: dx naar rechts, dy naar beneden). */
const naast = (p: Punt, dx: number, dy: number) => { const s = scherm(p); return { x: s.x + dx, y: s.y + dy }; };
const knoop = (id: number) => stand.model.nodes.find((n) => n.id === id);
const nieuwsteKnoop = () => stand.model.nodes[stand.model.nodes.length - 1];
const nieuwsteStaaf = () => stand.model.beams[stand.model.beams.length - 1];
/** De zichtbare gestippelde spoorlijnen in de scène (aantal lijnstukken). */
function spoorLijnStukken(): number {
  let aantal = 0;
  renderScene?.traverse((o) => {
    const lijn = o as THREE.LineSegments;
    if (lijn.isLineSegments && lijn.visible && (lijn.material as THREE.Material).type === "LineDashedMaterial") {
      aantal += lijn.geometry.drawRange.count / 2;
    }
  });
  return aantal;
}
const spoorKnop = () => [...container.querySelectorAll<HTMLButtonElement>(".status-snap-btn")]
  .find((b) => b.textContent === i18next.t("snap.spoor"));

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  document.documentElement.setAttribute("data-theme", "light");
  herstelSnapBeginstand();
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("uitlijnen: knoop 3 verworven, staaf van knoop 1 naar (2; 4,2) — spoorlijn, tekst en maatlabel; eindpunt exact", async () => {
    await begin();
    info.push(`${pxPerMeter().toFixed(1)} px per meter`);
    await klik(scherm(K1));
    gelijk(stand.selectie, { type: "node", id: 1 }, "beginpunt knoop 1");
    await hang(scherm(K3));
    ok((tekenvlak().dataset.openFem3dSpoorVerworven ?? "").split(",").includes("knoop:3"), `knoop 3 verworven: ${tekenvlak().dataset.openFem3dSpoorVerworven}`);
    // 4 px onder de X-spoorlijn door knoop 3 (y = 4,2); het raster gaf y = 4,0.
    const plek = naast([2.1, 4.2, 0], 0, 4);
    await wijs(plek);
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "spoor", "het objectspoor gaf het punt");
    gelijk(hint()?.hidden, false, "tekst bij de cursor zichtbaar");
    gelijk(hint()?.textContent, "uitlijnen X met knoop 3 · 4000 mm", "tekst bij de cursor");
    ok(spoorLijnStukken() >= 1, `een gestippelde spoorlijn in beeld (${spoorLijnStukken()})`);
    gelijk(maatLabel()?.hidden, false, "maatlabel zichtbaar");
    gelijk(maatLabel()?.textContent, "4472,1 mm · 63,4°", "maatlabel: lengte in mm en richting");
    await klik(plek);
    const nieuw = nieuwsteKnoop();
    gelijk([nieuw.id, nieuw.x, nieuw.y, nieuw.z], [4, 2, 4.2, 0], "nieuwe knoop exact op (2; 4,2; 0)");
    gelijk([nieuwsteStaaf().startNodeId, nieuwsteStaaf().endNodeId], [1, 4], "staaf van knoop 1 naar knoop 4");
  });

  await test("scheef (perspectief): uitlijnen op knoop 3 in het werkvlak peil 0 — eindpunt exact op (2; 4,2; 0)", async () => {
    mount(<Werkruimte begin={model()} camera={{ position: [-4, -8, 9], target: [3, 2.2, 0], up: [0, 0, 1] }} />);
    await wacht(300);
    flushSync(() => zet.tool("addBeam"));
    await wacht(80);
    await klik(scherm(K1));
    await hang(scherm(K3));
    // 4 px naast de X-spoorlijn door knoop 3, gemeten langs de schermrichting van −Y.
    const a = scherm([2.1, 4.2, 0]), b = scherm([2.1, 4.1, 0]);
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const plek = { x: a.x + 4 * (b.x - a.x) / l, y: a.y + 4 * (b.y - a.y) / l };
    await wijs(plek);
    gelijk([tekenvlak().dataset.openFem3dTekenpunt, hint()?.textContent], ["spoor", "uitlijnen X met knoop 3 · 4000 mm"], "spoor in scheef aanzicht");
    // De vangzone loodrecht in beeld: 7,5 px naast de beeldlijn (binnen de
    // 8 px) vangt ook hier; het voetpunt in de wereld lag in beeld ±8,5 px weg.
    const c = scherm([2.4, 4.2, 0]), d = scherm([2.5, 4.2, 0]);
    const ld = Math.hypot(d.x - c.x, d.y - c.y);
    for (const kant of [1, -1]) {
      await wijs({ x: c.x - kant * 7.5 * (d.y - c.y) / ld, y: c.y + kant * 7.5 * (d.x - c.x) / ld });
      gelijk(tekenvlak().dataset.openFem3dTekenpunt, "spoor", `7,5 px loodrecht in beeld (${kant > 0 ? "de ene" : "de andere"} kant)`);
    }
    await klik(plek);
    const nieuw = nieuwsteKnoop();
    gelijk([nieuw.x, nieuw.y, nieuw.z], [2, 4.2, 0], "exact, in het werkvlak");
  });

  await test("Alt: bij de klik en zonder muisbeweging zijn alle snaps (ook het spoor) tijdelijk uit", async () => {
    await begin();
    await klik(scherm(K1));
    await hang(scherm(K3));
    const plek = naast([2.1, 4.2, 0], 0, 4);
    await wijs(plek);
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "spoor", "zonder Alt: spoor");
    toets("Alt");
    gelijk([tekenvlak().dataset.openFem3dTekenpunt, hint()?.textContent], ["vrij", i18next.t("ribbon:openFem3d.spoor.snapUit")], "Alt ingedrukt, muis stil");
    toets("Alt", "keyup");
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "spoor", "Alt los: weer het spoor");
    await klik(plek, { alt: true });
    const nieuw = nieuwsteKnoop();
    ok(nieuw.id === 4 && Math.abs(nieuw.y - 4.2) > 0.01 && Math.abs(nieuw.y - 4) > 0.01 && Math.abs(nieuw.x * 2 - Math.round(nieuw.x * 2)) > 1e-6,
      `de klik met Alt landt op het muispunt, niet op spoor of raster: ${JSON.stringify(nieuw)}`);
    // Ook de knoopsnap: 5 px naast knoop 3.
    const bijK3 = naast(K3, 5, 0);
    await wijs(bijK3);
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "knoop", "zonder Alt: knoop 3");
    toets("Alt");
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "vrij", "met Alt: geen knoopsnap");
    await klik(bijK3, { alt: true });
    toets("Alt", "keyup");
    const k5 = nieuwsteKnoop();
    ok(k5.id === 5 && Math.abs(k5.x - 6) > 0.05 && Math.abs(k5.x - 6) < 0.25 && Math.abs(k5.y - 4.2) < 0.02,
      `met Alt een nieuwe knoop naast knoop 3: ${JSON.stringify(k5)}`);
    gelijk([nieuwsteStaaf().startNodeId, nieuwsteStaaf().endNodeId], [4, 5], "de staaf eindigt op de nieuwe knoop, niet op knoop 3");
  });

  await test("objectspoor uit met het knopje in de statusbalk: niets verworven, het raster wint; weer aan in de tab Weergave", async () => {
    await begin(ZICHT, true);
    const knop = spoorKnop();
    ok(knop, "knopje Objectspoor in de statusbalk");
    gelijk([...container.querySelectorAll(".status-snap-btn")].map((b) => b.textContent),
      ["Knoop", "Stramien", "Raster", "Objectspoor"], "de snapknopjes van 3D");
    gelijk(knop!.getAttribute("aria-pressed"), "true", "standaard aan");
    flushSync(() => knop!.click());
    gelijk([leesSnapInstellingen().spoor, spoorKnop()!.getAttribute("aria-pressed")], [false, "false"], "uit");
    await klik(scherm(K1));
    await hang(scherm(K3));
    gelijk(tekenvlak().dataset.openFem3dSpoorVerworven ?? "", "", "niets verworven");
    const plek = naast([2.1, 4.2, 0], 0, 4);
    await wijs(plek);
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "raster", "het raster wint");
    gelijk(spoorLijnStukken(), 0, "geen spoorlijn");
    // Het beginpunt is altijd 'verworven': 3 px naast de Y-lijn door knoop 1
    // gaf met het objectspoor aan 'uitlijnen Y met knoop 1'. Nu niet.
    await wijs(naast([0, 3, 0], 3, 0));
    gelijk([tekenvlak().dataset.openFem3dTekenpunt, hint()?.textContent, tekenvlak().dataset.openFem3dSpoorTekst],
      ["raster", "Raster", "Raster"], "3 px naast de Y-lijn door het beginpunt: het raster, geen spoor");
    gelijk(spoorLijnStukken(), 0, "ook daar geen spoorlijn");
    await klik(plek);
    gelijk([nieuwsteKnoop().x, nieuwsteKnoop().y], [2, 4], "knoop op het raster (2; 4)");
    const rij = [...container.querySelectorAll<HTMLButtonElement>(".verkenner [role='switch']")]
      .find((b) => b.textContent === i18next.t("snap.spoor"));
    ok(rij, "rij Objectspoor in de tab Weergave");
    gelijk(rij!.getAttribute("aria-checked"), "false", "ook daar uit");
    flushSync(() => rij!.click());
    gelijk([leesSnapInstellingen().spoor, spoorKnop()!.getAttribute("aria-pressed")], [true, "true"], "weer aan, ook in de statusbalk");
  });

  await test("verlengen: staaf 1 verworven, een staaf van knoop 3 naar (8; 0,2) op de verlenging", async () => {
    await begin();
    await hang(scherm([3, 0.2, 0]));
    ok((tekenvlak().dataset.openFem3dSpoorVerworven ?? "").split(",").includes("staaf:1"), `staaf 1 verworven: ${tekenvlak().dataset.openFem3dSpoorVerworven}`);
    await klik(scherm(K3));
    gelijk(stand.selectie, { type: "node", id: 3 }, "beginpunt knoop 3");
    const plek = naast([8.1, 0.2, 0], 0, 4);
    await wijs(plek);
    gelijk([tekenvlak().dataset.openFem3dTekenpunt, hint()?.textContent], ["spoor", "verlengen staaf 1 · 2000 mm"], "verlengen");
    await klik(plek);
    const nieuw = nieuwsteKnoop();
    gelijk([nieuw.x, nieuw.y, nieuw.z], [8, 0.2, 0], "nieuwe knoop exact op de verlenging (8; 0,2)");
    gelijk([nieuwsteStaaf().startNodeId, nieuwsteStaaf().endNodeId], [3, nieuw.id], "staaf vanaf knoop 3");
  });

  await test("directe invoer: 4500 mm typen langs Y en Enter; Esc wist eerst alleen de maat", async () => {
    await begin();
    await klik(scherm(K1));
    // Bijna recht omhoog: de Y-spoorlijn door het beginpunt geeft de richting +Y.
    await wijs(naast([0, 3, 0], 3, 0));
    gelijk(tekenvlak().dataset.openFem3dSpoorTekst?.startsWith("uitlijnen Y met knoop 1"), true, "richting langs Y door het beginpunt");
    for (const k of ["1", "2"]) toets(k);
    gelijk(maatLabel()?.textContent, "12 mm ↵", "getypt 12");
    toets("Escape");
    gelijk([tekenvlak().dataset.openFem3dMaatInvoer, stand.tool], ["", "addBeam"], "Esc wist de maat, de staaf blijft in aanbouw");
    for (const k of ["4", "5", "0", "0", ",", "5"]) toets(k);
    gelijk([maatLabel()?.textContent, maatLabel()?.classList.contains("invoer")], ["4500,5 mm ↵", true], "getypt 4500,5 (komma)");
    toets("Backspace"); toets("Backspace");
    gelijk(maatLabel()?.textContent, "4500 mm ↵", "Backspace: 4500");
    toets("Enter");
    await wacht(80);
    const nieuw = nieuwsteKnoop();
    ok(nieuw.id === 4 && nieuw.x === 0 && nieuw.z === 0, `nieuwe knoop recht boven knoop 1: ${JSON.stringify(nieuw)}`);
    ongeveer(nieuw.y - 0.2, 4.5, 1e-9, "precies 4500 mm");
    gelijk([nieuwsteStaaf().startNodeId, nieuwsteStaaf().endNodeId], [1, 4], "staaf van knoop 1 naar knoop 4");
    gelijk(tekenvlak().dataset.openFem3dMaatInvoer, "", "de maat is verbruikt");
    toets("Escape");
    await wacht(40);
    gelijk(stand.tool, "select", "Esc zonder maat stopt het gereedschap");
    info.push(`directe invoer: knoop 4 op y = ${nieuw.y}`);
  });

  await test("een getypte maat vervalt bij een muisklik (zoals in 2D): daarna geen maat '↵' en Enter doet niets", async () => {
    await begin();
    await klik(scherm(K1));
    await wijs(naast([0, 3, 0], 3, 0));
    for (const k of ["4", "5", "0", "0"]) toets(k);
    gelijk(maatLabel()?.textContent, "4500 mm ↵", "getypt");
    await klik(naast([0, 2, 0], 3, 0));
    const k4 = nieuwsteKnoop();
    gelijk([k4.id, k4.x, k4.y, k4.z], [4, 0, 2, 0], "de klik zet het punt onder de muis (zoals in 2D)");
    gelijk(tekenvlak().dataset.openFem3dMaatInvoer, "", "de getypte maat is vervallen");
    await wijs(naast([0, 4, 0], 3, 0));
    gelijk(maatLabel()?.textContent, "2000 mm · 90°", "het volgende segment toont zijn eigen lengte, geen getypte maat");
    const aantal = stand.model.nodes.length;
    toets("Enter");
    await wacht(80);
    gelijk(stand.model.nodes.length, aantal, "Enter doet niets");
    toets("Escape");
    await wacht(40);
    gelijk(stand.tool, "select", "de eerste Esc stopt het gereedschap (er staat geen maat meer)");
  });

  for (const variant of ["raster aan", "raster uit", "Shift"] as const) {
    await test(`aansluiten (${variant}): 1 px naast staaf 1 (buiten het raster) geklikt — staaf 1 splitst op het snijpunt met de spoorlijn, niet op het muispunt`, async () => {
      if (variant === "raster uit") zetSnap("raster", false);
      await begin(ZICHT, false, modelDoel());
      await klik(scherm([0, 1.3, 0]));
      gelijk(stand.selectie, { type: "node", id: 3 }, "beginpunt knoop 3");
      // 1 px naast de as van staaf 1, 3 px onder de X-lijn door het
      // beginpunt: het muispunt ligt ±65 mm lager dan het snijpunt (4,25; 1,3).
      const plek = naast([4.25, 1.3, 0], 1, 3);
      const toetsen = variant === "Shift" ? { shift: true } : {};
      await wijs(plek, toetsen);
      gelijk(tekenvlak().dataset.openFem3dTekenpunt, variant === "Shift" ? "ortho" : "spoor", "het tekenpunt");
      await klik(plek, toetsen);
      gelijk(tekenvlak().dataset.openFem3dPickType, "beam", "de klik raakt staaf 1");
      gelijk(tekenvlak().dataset.openFem3dStaafSplitsing, "1:lijn", "gesplitst op het snijpunt van de lijn met de staaf");
      const k4 = knoop(4);
      ok(k4, "nieuwe knoop 4");
      ongeveer(k4!.x, 4.25, 1e-9, "knoop 4: x op staaf 1");
      ongeveer(k4!.y, 1.3, 1e-9, "knoop 4: y op de spoorlijn (niet het muispunt)");
      gelijk(k4!.z, 0, "knoop 4: z");
      gelijk(staven(), [[1, 1, 4], [2, 4, 2], [3, 3, 4]], "staaf 1 gesplitst, de nieuwe staaf verbonden");
      info.push(`aansluiten (${variant}): knoop 4 op (${k4!.x}; ${k4!.y})`);
    });
  }

  await test("voetpunt: loodrecht op staaf 1, 6 px naast de staaf geklikt — staaf 1 splitst op het voetpunt (2,3; 0)", async () => {
    await begin(ZICHT, false, modelVoet());
    await hang(scherm([4.5, 0, 0]));
    gelijk(verworvenLijst(), "staaf:1", "staaf 1 verworven");
    await klik(scherm([2.3, 3.7, 0]));
    gelijk(stand.selectie, { type: "node", id: 3 }, "beginpunt knoop 3");
    // 6 px onder de staafas (de profielrand ligt op ruim 2 px).
    const plek = naast([2.3, 0, 0], 0, 6);
    await wijs(plek);
    gelijk([tekenvlak().dataset.openFem3dTekenpunt, hint()?.textContent], ["voetpunt", "loodrecht op staaf 1 (voetpunt)"], "het voetpunt");
    await klik(plek);
    gelijk([tekenvlak().dataset.openFem3dPickType, tekenvlak().dataset.openFem3dStaafSplitsing], ["none", "1:voetpunt"],
      "de klik zelf raakt staaf 1 niet; het voetpunt splitst staaf 1");
    const k4 = knoop(4);
    ok(k4, "nieuwe knoop 4");
    gelijk([k4!.x, k4!.y, k4!.z], [2.3, 0, 0], "knoop 4 op het voetpunt");
    gelijk(staven(), [[1, 1, 4], [2, 4, 2], [3, 3, 4]], "staaf 1 gesplitst, de nieuwe staaf verbonden");
  });

  await test("grote hal (972 knopen, 2484 staven): zeven items verworven, het spoor werkt; de tijd per muisstand meet test-open-fem3d-tekenhulp", async () => {
    // Headless met virtuele tijd staat de klok stil tijdens de rekenregels;
    // de tijd per muisstand en per verwerving meet daarom de Node-proef [13].
    // Parallel bovenaanzicht: de drie lagen vallen in beeld precies samen (in
    // perspectief ligt een knoop van de onderste laag soms binnen de vangzone).
    mount(<Werkruimte begin={hal()} zicht={{ ...ZICHT, perspective: false }}
      camera={{ position: [13, 13, 38], target: [13, 13, 8], up: [0, 1, 0] }} />);
    await wacht(400);
    flushSync(() => zet.tool("addBeam"));
    await wacht(80);
    // Vier knopen en drie staven verwerven (de muis 0,4 s erboven); in
    // bovenaanzicht wint de bovenste laag (z = 8 m).
    for (const p of [[4, 4, 8], [10, 2, 8], [16, 12, 8], [26, 20, 8]] as Punt[]) await hang(scherm(p));
    for (const p of [[7, 6, 8], [12, 15, 8], [21, 24, 8]] as Punt[]) await hang(scherm(p));
    const verworven = (tekenvlak().dataset.openFem3dSpoorVerworven ?? "").split(",");
    gelijk(verworven.map((v) => v.split(":")[0]), ["knoop", "knoop", "knoop", "knoop", "staaf", "staaf", "staaf"], `zeven verworven: ${verworven.join(",")}`);
    await hang(scherm([1, 1, 8]));
    gelijk((tekenvlak().dataset.openFem3dSpoorVerworven ?? "").split(",").length, 7, "midden in een vak: niets nieuws verworven, nog steeds zeven");
    await klik(scherm([0, 0, 8]));
    // 3 px onder de X-spoorlijn door de verworven knoop (4; 4; 8), 1 m ernaast.
    await wijs(naast([5, 4, 8], 0, 3));
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "spoor", "het spoor in de grote hal");
    ok(/^uitlijnen X met knoop \d+ · 1000 mm$/.test(hint()?.textContent ?? ""), `tekst: ${hint()?.textContent}`);
    await klik(naast([5, 4, 8], 0, 3));
    const nieuw = nieuwsteKnoop();
    gelijk([nieuw.x, nieuw.y, nieuw.z], [5, 4, 8], "het eindpunt op de spoorlijn, in het werkvlak door het beginpunt (z = 8 m)");
  });

  await test("Shift: ortho langs Y vanaf het beginpunt", async () => {
    await begin();
    await klik(scherm(K1));
    const plek = naast([0.9, 3.1, 0], 0, 0);
    await wijs(plek, { shift: true });
    gelijk([tekenvlak().dataset.openFem3dTekenpunt, hint()?.textContent], ["ortho", "ortho Y"], "ortho Y");
    await klik(plek, { shift: true });
    const nieuw = nieuwsteKnoop();
    gelijk([nieuw.x, nieuw.y, nieuw.z], [0, 3, 0], "recht boven knoop 1, de lengte op het raster");
  });

  await test("plaatomtrek: na het eerste hoekpunt 4500 mm intypen en Enter; Shift geeft ortho", async () => {
    await begin(ZICHT, false, model(), "addPlate");
    await klik(scherm([1, 2, 0]));
    const k4 = nieuwsteKnoop();
    gelijk([k4.id, k4.x, k4.y, k4.z], [4, 1, 2, 0], "eerste hoekpunt op het raster (1; 2)");
    await wijs(naast([3, 2, 0], 0, 3));
    ok(tekenvlak().dataset.openFem3dSpoorTekst?.startsWith("uitlijnen X met knoop 4"), `richting langs X: ${tekenvlak().dataset.openFem3dSpoorTekst}`);
    for (const k of ["4", "5", "0", "0"]) toets(k);
    gelijk(maatLabel()?.textContent, "4500 mm ↵", "getypt");
    toets("Enter");
    await wacht(80);
    const k5 = nieuwsteKnoop();
    gelijk([k5.id, k5.y, k5.z], [5, 2, 0], "tweede hoekpunt");
    ongeveer(k5.x - 1, 4.5, 1e-9, "precies 4500 mm");
    gelijk([tekenvlak().dataset.openFem3dDraftSegments, stand.tool], ["1", "addPlate"], "één zijde van de omtrek, het gereedschap loopt door");
    await wijs(naast([5.7, 3.3, 0], 0, 0), { shift: true });
    gelijk([tekenvlak().dataset.openFem3dTekenpunt, hint()?.textContent], ["ortho", "ortho Y"], "Shift: ortho langs Y vanaf hoekpunt 2");
    toets("Escape");
    await wacht(40);
  });

  await test("voorrang: het spoor gaat voor het stramien; langs de spoorlijn neemt het punt de stramienas (x = 2,1)", async () => {
    await begin(ZICHT, false, model(), "addBeam", STRAMIEN);
    await klik(scherm(K1));
    await hang(scherm(K3));
    ok(verworvenLijst().split(",").includes("knoop:3"), `knoop 3 verworven: ${verworvenLijst()}`);
    // 2 px naast de stramienas, 4 px onder de X-lijn door knoop 3.
    const plek = naast([2.1, 4.2, 0], 2, 4);
    flushSync(() => zetSnap("spoor", false));
    await wijs(plek);
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "stramien", "objectspoor uit: hier vangt het stramien");
    flushSync(() => zetSnap("spoor", true));
    await wijs(naast([2.1, 4.2, 0], 2, 3));
    gelijk([tekenvlak().dataset.openFem3dTekenpunt, hint()?.textContent], ["spoor", "uitlijnen X met knoop 3 · 3900 mm"], "objectspoor aan: het spoor wint");
    await klik(naast([2.1, 4.2, 0], 2, 3));
    const nieuw = nieuwsteKnoop();
    gelijk([nieuw.id, nieuw.x, nieuw.y, nieuw.z], [4, 2.1, 4.2, 0], "op de spoorlijn (y = 4,2) en de stramienas (x = 2,1)");
  });

  await test("verwerven: een knoop tot 10 px (8 px wel, 14 px niet), een staaf tot 6 px (5 px wel, 8 px niet)", async () => {
    await begin();
    await hang(naast(K3, 14, 0));
    gelijk(verworvenLijst(), "", "14 px naast knoop 3: niets verworven");
    await hang(naast([3, 0.2, 0], 0, 8));
    gelijk(verworvenLijst(), "", "8 px naast staaf 1: niets verworven");
    // Tussendoor elders: een stap binnen 4 px telt als stilstaan (geen nieuwe poging).
    await hang(naast(K3, 8, 0));
    gelijk(verworvenLijst(), "knoop:3", "8 px naast knoop 3: verworven");
    await hang(naast([3, 0.2, 0], 0, 5));
    gelijk(verworvenLijst(), "knoop:3,staaf:1", "5 px naast staaf 1: verworven");
  });

  await test("het maatlabel en de tekst bij de cursor overlappen niet, ook bij een korte staaf", async () => {
    await begin();
    await klik(scherm(K1));
    const raakt = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const rechthoek = (r: DOMRect) => `[${[r.left, r.top, r.right, r.bottom].map((v) => v.toFixed(0)).join(",")}]`;
    const gevallen: [string, Punt][] = [
      ["schuin omhoog naar rechts", [0.5, 1.2, 0]], ["schuin 45°", [1, 1.2, 0]], ["naar rechts (spoor)", [1, 0.2, 0]],
      ["schuin omhoog naar links", [-0.5, 1.2, 0]], ["recht omhoog (spoor)", [0.02, 1.24, 0]], ["lang", [2, 2.2, 0]],
    ];
    for (const [naam, p] of gevallen) {
      await wijs(scherm(p));
      ok(maatLabel() && !maatLabel()!.hidden && hint() && !hint()!.hidden, `${naam}: maatlabel en tekst in beeld`);
      const l = maatLabel()!.getBoundingClientRect(), h = hint()!.getBoundingClientRect();
      ok(!raakt(l, h), `${naam}: '${maatLabel()!.textContent}' ${rechthoek(l)} raakt '${hint()!.textContent}' ${rechthoek(h)}`);
    }
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  const zicht: OpenFem3DVisibility = { ...ZICHT, nodeNumbers: true, beamNumbers: true };
  if (beeld === "spoor") {
    await begin(zicht);
    await hang(scherm([3, 0.2, 0]));
    await klik(scherm(K1));
    await hang(scherm(K3));
    await wijs(naast([2.1, 4.2, 0], 0, 4));
    return;
  }
  if (beeld === "schakelaars") {
    await begin(zicht, true);
    container.querySelector(".verkenner .explorer-view-section:last-child")?.scrollIntoView();
    await klik(scherm(K1));
    await wijs(naast([3.6, 2.1, 0], 0, 0));
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, info, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, info, error: String(e?.stack ?? e) }); });
