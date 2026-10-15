/**
 * Browserkant van test-open-fem3d-section-box-ui.mjs: de section box (issue
 * #86) in de echte 3D-werkruimte (OpenFem3DEditor met ThreeFrameCanvas,
 * WebGL), met echte PointerEvents en toetsen. De rekenregels zelf staan in
 * test-open-fem3d-section-box.mjs.
 *
 * Model: twee portalen van 6 m breed en 3 m hoog, op y = 0 (knopen 1–4,
 * staven 1–3) en y = 6 (knopen 5–8, staven 4–6), met twee gordingen ertussen
 * (staaf 7: 2–6, staaf 8: 3–7). Bovenaanzicht, 6 m in beeld. De doos om het
 * model: [−0,9; −0,9; −0,9] … [6,9; 6,9; 3,9] (marge 0,1 × 9 m).
 *
 * Bewaakt:
 *  - het menu ▾ van de view cube: Section box aan (vinkje, de modelgrenzen
 *    plus marge, snel pad zonder opbouw), Reset, passend op selectie (zonder
 *    selectie uitgeschakeld);
 *  - een vlak slepen: de greep +y naar y = 3 m; de camera draait niet mee,
 *    tijdens het slepen geen opbouw en geen nieuwe shader; bij het loslaten
 *    in de zichtbaarheid; Esc tijdens het slepen zet de doos terug;
 *  - buiten de doos: staaf 5 niet in beeld (beeldpunt) en niet kiesbaar; een
 *    staaf binnen wel; de gording op de rand alleen op haar zichtbare stuk;
 *  - het selectievenster neemt alleen mee wat binnen de doos valt;
 *  - snappen: niet op een knoop buiten de doos, wel binnen;
 *  - labels: een knoopnummer buiten de doos verdwijnt;
 *  - passend beeld past op de doos;
 *  - een view bewaart de doos (venster Views) en zet hem terug;
 *  - de grepen staan in de eerste render na aan, passend op selectie en
 *    Reset op hun vlak (de wereldmatrix waarmee ze getekend worden);
 *  - recht van boven wijzen de grepen ±z naar de kijker: niet getekend, geen
 *    handje, en een klik midden in de doos kiest de staaf eronder
 *    (perspectief en parallel);
 *  - een dakplaat: het deel buiten de doos niet in beeld en niet kiesbaar,
 *    het deel binnen wel; plaat en plaatranden hebben de vlakken;
 *  - objectspoor: een verworven knoop die na het slepen van een vlak buiten
 *    de doos valt, geeft geen spoor meer;
 *  - prestatie in een hal van 631 staven: twintig sleepstappen zonder
 *    opbouw van de scène en zonder nieuwe shader.
 *
 * `#beeld=hal` (de hal iso met een doos en grepen) en `#beeld=menu` (het menu
 * ▾ open) tonen alleen een beeld voor een schermafbeelding. De uitslag komt
 * als JSON in #uitslag.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as THREE from "three";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/themes.css";
import "../src/App.css";
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { maakStaalhal } from "../src/components/openFem3d/wizards/staalhal";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DTool } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState, OpenFem3DViewSet } from "../src/components/openFem3d/openFem3dViewSets";
import {
  OPEN_FEM_3D_SECTION_BOX_VLAKKEN, openFem3DSectionBoxVlakMidden, type OpenFem3DSectionBox,
} from "../src/components/openFem3d/openFem3dSectionBox";
import { OPEN_FEM_3D_SECTION_BOX_GREEP_PX } from "../src/components/openFem3d/openFem3dSectionBoxBeeld";
import { herstelSnapBeginstand } from "../src/hooks/useSnapInstellingen";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};
Element.prototype.hasPointerCapture = function () { return false; };
// Headless met virtuele tijd tekent geen beeldjes: één render per beeldje loopt via een timer.
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);

// De camera, scène en renderer waarmee het tekenvlak echt tekent.
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

/* ── Model en werkruimte ─────────────────────────────────────────────── */

type Punt = [number, number, number];
const KNOPEN: Punt[] = [[0, 0, 0], [0, 0, 3], [6, 0, 3], [6, 0, 0], [0, 6, 0], [0, 6, 3], [6, 6, 3], [6, 6, 0]];
const STAVEN = [[1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [2, 6], [3, 7]];
/** Een model: knopen en staven genummerd vanaf 1; platen als lijst knoopnummers (200 mm beton). */
function bouw(knopen: Punt[], staven: number[][], platen: number[][] = []): OpenFem3DModel {
  return parseOpenFem3DModel({
    nodes: knopen.map(([x, y, z], i) => ({ id: i + 1, x, y, z })),
    beams: staven.map(([a, b], i) => ({ id: i + 1, startNodeId: a, endNodeId: b, profileName: "IPE 200", material: "S235" })),
    supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], surfaceLoads: [],
    plates: platen.map((nodeIds, i) => ({ id: i + 1, nodeIds, thicknessM: 0.2, material: "C30/37" })),
  });
}
const portalen = () => bouw(KNOPEN, STAVEN);
const hal = () => maakStaalhal({ lengteMm: 42_000, aantalVakken: 7, gordingafstandMm: 1500, verbanden: { vakken: "alle", dak: true, wanden: true } }).model;
const ZICHT: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY,
  grid: false, axes: false, structuralGrid: false, levelMarks: false, nodeNumbers: false,
  deformation: false, reactions: false, utilization: false,
};
/** Recht van boven: x naar rechts, y naar boven in beeld. */
const BOVEN: OpenFem3DCameraState = { position: [3, 3, 30], target: [3, 3, 1.5], up: [0, 0, 1] };
const MODELDOOS = { min: [-0.9, -0.9, -0.9], max: [6.9, 6.9, 3.9] };

interface Stand {
  model: OpenFem3DModel; tool: OpenFem3DTool; selectie: OpenFem3DSelection; zicht: OpenFem3DVisibility; views: OpenFem3DViewSet[];
}
let stand: Stand;
let zet: {
  tool: (t: OpenFem3DTool) => void; selectie: (s: OpenFem3DSelection) => void; zicht: (v: OpenFem3DVisibility) => void;
  vensterOpen: (open: boolean) => void;
};

function Werkruimte({ begin, zicht = ZICHT, camera = { ...BOVEN, up: [0, 1, 0] }, breed = 900, hoog = 640 }: {
  begin: OpenFem3DModel; zicht?: OpenFem3DVisibility; camera?: OpenFem3DCameraState; breed?: number; hoog?: number;
}) {
  const [m, setM] = React.useState(begin);
  const [tool, setTool] = React.useState<OpenFem3DTool>("select");
  const [selectie, setSelectie] = React.useState<OpenFem3DSelection>(null);
  const [v, setV] = React.useState(zicht);
  const [views, setViews] = React.useState<OpenFem3DViewSet[]>([]);
  const [vensterOpen, setVensterOpen] = React.useState(false);
  stand = { model: m, tool, selectie, zicht: v, views };
  zet = { tool: setTool, selectie: setSelectie, zicht: setV, vensterOpen: setVensterOpen };
  return (
    <div style={{ width: breed, height: hoog, position: "relative", display: "flex" }}>
      <OpenFem3DEditor model={m} onChange={setM} visibility={v} onVisibilityChange={setV}
        tool={tool} onToolChange={setTool} selection={selectie} onSelectionChange={setSelectie}
        showLoadCase={false} initialCamera={camera}
        visibilityOpen={vensterOpen} onVisibilityClose={() => setVensterOpen(false)}
        viewSets={views} onViewSetsChange={setViews} onApplyViewSet={(view) => setV({ ...view.visibility })} />
    </div>
  );
}

const tekenvlak = () => container.querySelector<HTMLElement>(".open-fem3d-canvas")!;
const canvas3d = () => container.querySelector<HTMLCanvasElement>(".open-fem3d-canvas canvas")!;
const kubusEl = () => container.querySelector<HTMLElement>(".open-fem3d-view-cube")!;
const menuKnopEl = () => kubusEl().querySelector<HTMLButtonElement>("[data-open-fem3d-view-cube-menuknop]")!;
const menuEl = () => kubusEl().querySelector<HTMLElement>(".open-fem3d-view-cube-menu")!;
const menuItemEl = (id: string) => kubusEl().querySelector<HTMLElement>(`[data-open-fem3d-view-cube-menuitem="${id}"]`)!;

/** Schermpunt (client) van een wereldpunt, met de camera waarmee het tekenvlak tekent. */
function scherm(p: Punt): { x: number; y: number } {
  ok(renderCamera, "er is getekend");
  renderCamera!.updateMatrixWorld();
  const rect = canvas3d().getBoundingClientRect();
  const n = new THREE.Vector3(...p).project(renderCamera!);
  return { x: rect.left + (n.x + 1) / 2 * rect.width, y: rect.top + (1 - n.y) / 2 * rect.height };
}
/** De greep `id` ("+y", …) zoals hij getekend is. */
function greep(id: string): THREE.Mesh {
  let gevonden: THREE.Mesh | null = null;
  renderScene?.traverse((o) => { if (o.userData.openFem3dSectionBoxGreep === id) gevonden = o as THREE.Mesh; });
  ok(gevonden, `greep ${id} in de scène`);
  return gevonden!;
}
function wijzer(type: string, punt: { x: number; y: number }, knop = -1, knoppen = 0, extra: PointerEventInit = {}) {
  flushSync(() => canvas3d().dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true,
    clientX: punt.x, clientY: punt.y, button: knop, buttons: knoppen, ...extra,
  })));
}
async function klik(punt: { x: number; y: number }) {
  wijzer("pointermove", punt);
  wijzer("pointerdown", punt, 0, 1);
  wijzer("pointerup", punt, 0, 0);
  await wacht(60);
}
function toets(key: string) {
  flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}
/** Een echte klik op een element (midden, na de hit-test van de browser). */
function klikEcht(el: Element, wat: string) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const raak = document.elementFromPoint(x, y);
  ok(raak !== null && (raak === el || el.contains(raak)), `${wat} ligt niet bovenop; geraakt: ${(raak as HTMLElement | null)?.className}`);
  const init = { clientX: x, clientY: y, button: 0, pointerId: 11, pointerType: "mouse", bubbles: true, cancelable: true, composed: true };
  flushSync(() => {
    raak!.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
    raak!.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    raak!.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 }));
  });
}
async function menu(id: string) {
  if (menuEl().hidden) klikEcht(menuKnopEl(), "knop ▾");
  ok(!menuEl().hidden, "menu open");
  klikEcht(menuItemEl(id), `menu-item ${id}`);
  await wacht(80);
}
/** De kleur van het beeld op schermpunt `p` (opnieuw getekend en meteen uitgelezen). */
function beeldpunt(p: { x: number; y: number }): [number, number, number] {
  ok(renderRenderer && renderScene && renderCamera, "er is getekend");
  renderRenderer!.render(renderScene!, renderCamera!);
  const gl = renderRenderer!.getContext();
  const doek = renderRenderer!.domElement;
  const r = doek.getBoundingClientRect();
  const sx = doek.width / doek.clientWidth, sy = doek.height / doek.clientHeight;
  const px = new Uint8Array(4);
  gl.readPixels(Math.round((p.x - r.left) * sx), Math.round(doek.height - (p.y - r.top) * sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [px[0]!, px[1]!, px[2]!];
}
const blauw = ([r, , b]: number[]) => b! > r! + 60;
const doos = (): OpenFem3DSectionBox => stand.zicht.sectionBox;
const verworven = () => (tekenvlak().dataset.openFem3dSpoorVerworven ?? "").split(",");
const geschiedenis = () => (tekenvlak().dataset.openFem3dBuildHistory ?? "").split(",");
/** Sleep greep `id` van zijn plek naar het schermpunt van `naar` (wereld), in `stappen` stappen. */
async function sleep(id: string, naar: (greepPositie: THREE.Vector3) => Punt, stappen = 6, loslaten = true) {
  const g = greep(id).position.clone();
  const van = scherm([g.x, g.y, g.z]);
  const doel = scherm(naar(g));
  wijzer("pointermove", van);
  await wacht(40);
  wijzer("pointerdown", van, 0, 1);
  for (let i = 1; i <= stappen; i += 1) {
    wijzer("pointermove", { x: van.x + (doel.x - van.x) * i / stappen, y: van.y + (doel.y - van.y) * i / stappen }, -1, 1);
    await wacht(20);
  }
  if (loslaten) {
    wijzer("pointerup", doel, 0, 0);
    await wacht(80);
  }
}
async function begin(model = portalen(), zicht = ZICHT) {
  mount(<Werkruimte begin={model} zicht={zicht} />);
  await wacht(300);
}

/* ── Proeven ─────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  document.documentElement.setAttribute("data-theme", "light");
  herstelSnapBeginstand();
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }
  const groep = new URLSearchParams(location.hash.slice(1)).get("groep");

  if (groep !== "prestatie") {
  await test("Exploderen via het kubusmenu: afstand, bediening en onveranderd rekenmodel", async () => {
    await begin();
    const original = stand.model;
    gelijk(menuItemEl("explode").getAttribute("aria-checked"), "false", "standaard uit");
    await menu("explode");
    await wacht(500);
    gelijk(stand.zicht.explode.amountM, 2, "twee meter per level");
    gelijk(menuItemEl("explode").getAttribute("aria-checked"), "true", "menu aangevinkt");
    gelijk(container.querySelector<HTMLInputElement>(".open-fem3d-explode input")?.value, "2000", "schuifregelaar in mm");
    ok(stand.model === original, "rekenmodel blijft hetzelfde object");
    await menu("explode");
    gelijk(stand.zicht.explode.amountM, 0, "normale weergave terug");
  });
  await test("Exploderen per elementsoort (issue #198): keuze in het paneel, ligger 2 stappen omhoog, kiezen geeft de echte knoop", async () => {
    // Vooraanzicht: x naar rechts, z omhoog. Kolommen 1 stap (2 m), liggers 2 stappen (4 m).
    mount(<Werkruimte begin={portalen()} camera={{ position: [3, -40, 4], target: [3, 0, 4], up: [0, 0, 1] }} />);
    await wacht(300);
    const original = stand.model;
    const keuze = container.querySelector<HTMLSelectElement>(".open-fem3d-explode select")!;
    ok(keuze, "keuze per level / per elementsoort");
    gelijk([...keuze.options].map((o) => o.value), ["levels", "elementTypes"], "twee standen");
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(keuze, "elementTypes");
      keuze.dispatchEvent(new Event("change", { bubbles: true }));
    });
    gelijk(stand.zicht.explode, { mode: "elementTypes", amountM: 0 }, "de stand, nog uit");
    await menu("explode");
    await wacht(600);
    gelijk(stand.zicht.explode, { mode: "elementTypes", amountM: 2 }, "aan via het menu: de stand blijft");
    gelijk(tekenvlak().closest(".open-fem3d-stage")?.querySelector<HTMLElement>(".open-fem3d-explode")?.dataset.openFem3dExplodeMode,
      "elementTypes", "het paneel toont de stand");
    await klik(scherm([3, 0, 3 + 2 * 2]));
    gelijk(stand.selectie, { type: "beam", id: 2 }, "ligger 2 getekend op z + 2 stappen");
    await klik(scherm([3, 0, 3]));
    gelijk(stand.selectie, null, "op de echte hoogte staat de ligger niet meer");
    await klik(scherm([6, 0, 3 + 2 * 2]));
    gelijk(stand.selectie, { type: "node", id: 3 }, "de weergaveknoop aan het liggereind kiest de echte knoop 3");
    ok(stand.model === original, "rekenmodel blijft hetzelfde object");
  });
  await test("menu ▾: Section box aan — het vinkje, de modelgrenzen plus marge, alleen tekenen (geen opbouw)", async () => {
    await begin();
    const regels = [...menuEl().querySelectorAll<HTMLElement>("[data-open-fem3d-view-cube-menuitem]")].map((el) => el.dataset.openFem3dViewCubeMenuitem);
    gelijk(regels, ["start", "passend", "perspectief", "explode", "sectionBox", "sectionBoxSelectie", "sectionBoxReset"], "de regels van het menu");
    gelijk([menuItemEl("sectionBox").getAttribute("role"), menuItemEl("sectionBox").getAttribute("aria-checked")],
      ["menuitemcheckbox", "false"], "een schakelaar, uit");
    gelijk(menuItemEl("sectionBoxSelectie").getAttribute("aria-disabled"), "true", "zonder selectie: passend op selectie uitgeschakeld");
    gelijk(menuItemEl("sectionBox").textContent, "Section box", "tekst");
    await menu("sectionBox");
    gelijk(doos(), { enabled: true, bounds: MODELDOOS }, "aan, om het model");
    gelijk(tekenvlak().dataset.openFem3dSectionBox, "-0.9,-0.9,-0.9;6.9,6.9,3.9", "het tekenvlak");
    gelijk(tekenvlak().dataset.openFem3dBuildMode, "section-box", "snel pad");
    gelijk(menuItemEl("sectionBox").getAttribute("aria-checked"), "true", "het vinkje");
    ok(Number(tekenvlak().dataset.openFem3dSectionBoxMaterialen) > 0, "de materialen van het model hebben de vlakken");
    ok(greep("+y").visible !== false && greep("+y").parent?.visible, "grepen in beeld");
    await menu("sectionBox");
    gelijk(doos(), { enabled: false, bounds: MODELDOOS }, "uit, de grenzen bewaard");
    gelijk(tekenvlak().dataset.openFem3dSectionBox, "uit", "uit in het tekenvlak");
  });

  await test("een vlak slepen: greep +y naar y = 3 m; de camera draait niet mee, geen opbouw en geen nieuwe shader; bewaard bij het loslaten", async () => {
    await begin();
    await menu("sectionBox");
    const camera = [tekenvlak().dataset.openFem3dCameraPosition, tekenvlak().dataset.openFem3dCameraTarget];
    const programmas = renderRenderer!.info.programs?.length ?? 0;
    const voor = geschiedenis().length;
    await sleep("+y", (g) => [g.x, g.y - 3.9, g.z], 8, false);
    gelijk(tekenvlak().dataset.openFem3dSectionBoxSleept, "+y", "tijdens het slepen");
    ok(Number(tekenvlak().dataset.openFem3dSectionBoxSleepstappen) >= 4, `sleepstappen: ${tekenvlak().dataset.openFem3dSectionBoxSleepstappen}`);
    gelijk(doos().bounds?.max[1], 6.9, "de zichtbaarheid verandert pas bij het loslaten");
    ok(tekenvlak().dataset.openFem3dSectionBox?.includes(";6.9,3,3.9"), `live: ${tekenvlak().dataset.openFem3dSectionBox}`);
    gelijk(renderRenderer!.info.programs?.length ?? 0, programmas, "geen nieuwe shader tijdens het slepen");
    const g = greep("+y").position;
    wijzer("pointerup", scherm([g.x, g.y, g.z]), 0, 0);
    await wacht(80);
    gelijk(doos(), { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } }, "bewaard");
    gelijk([tekenvlak().dataset.openFem3dCameraPosition, tekenvlak().dataset.openFem3dCameraTarget], camera, "de camera stond stil");
    ok(!geschiedenis().slice(voor).some((m) => m.startsWith("full")), `geen volledige opbouw: ${geschiedenis().join(",")}`);
    gelijk(tekenvlak().dataset.openFem3dBuildMode, "section-box", "na het loslaten alleen tekenen");
    gelijk(stand.selectie, null, "slepen selecteert niets");
  });

  await test("buiten de doos: staaf 5 (y = 6) niet in beeld en niet kiesbaar; staaf 2 binnen wel; een gording alleen op haar zichtbare stuk", async () => {
    await begin();
    const midden5 = scherm([3, 6, 3]);
    ok(blauw(beeldpunt(midden5)), `zonder doos is staaf 5 blauw: ${beeldpunt(midden5)}`);
    flushSync(() => zet.zicht({ ...stand.zicht, sectionBox: { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } } }));
    await wacht(120);
    ok(!blauw(beeldpunt(midden5)), `met doos is staaf 5 weg: ${beeldpunt(midden5)}`);
    ok(blauw(beeldpunt(scherm([3, 0, 3]))), "staaf 2 binnen de doos blijft");
    ok(blauw(beeldpunt(scherm([0, 1.5, 3]))) && !blauw(beeldpunt(scherm([0, 4.5, 3]))), "gording 7: tot y = 3 m in beeld, daarna niet");
    await klik(midden5);
    gelijk([stand.selectie, tekenvlak().dataset.openFem3dPickType], [null, "none"], "klik op staaf 5: niets");
    await klik(scherm([0, 4.5, 3]));
    gelijk(stand.selectie, null, "klik op het weggeknipte stuk van gording 7: niets");
    await klik(scherm([0, 1.5, 3]));
    gelijk(stand.selectie, { type: "beam", id: 7 }, "klik op het zichtbare stuk van gording 7");
    await klik(scherm([3, 0, 3]));
    gelijk(stand.selectie, { type: "beam", id: 2 }, "staaf 2");
  });

  await test("selectievenster over het hele model: alleen wat binnen de doos valt (knopen 1–4, staven 1–3 en de zichtbare gordingen)", async () => {
    await begin();
    flushSync(() => zet.zicht({ ...stand.zicht, sectionBox: { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } } }));
    await wacht(120);
    const van = scherm([-2.5, 8.5, 0]), naar = scherm([8.5, -2.5, 0]);
    wijzer("pointerdown", van, 0, 1);
    wijzer("pointermove", { x: (van.x + naar.x) / 2, y: (van.y + naar.y) / 2 }, -1, 1);
    wijzer("pointermove", naar, -1, 1);
    wijzer("pointerup", naar, 0, 0);
    await wacht(80);
    gelijk(stand.selectie, { type: "multi", nodeIds: [1, 2, 3, 4], beamIds: [1, 2, 3, 7, 8] }, "venster");
    gelijk(tekenvlak().dataset.openFem3dBoxSelectMode, "venster", "modus");
  });

  await test("snappen: niet op een knoop buiten de doos (knoop 7), wel binnen (knoop 3)", async () => {
    await begin();
    flushSync(() => zet.tool("addNode"));
    await wacht(80);
    const bij7 = scherm([6, 6, 3]);
    wijzer("pointermove", { x: bij7.x + 3, y: bij7.y });
    await wacht(60);
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "knoop", "zonder doos: knoop 7");
    flushSync(() => zet.zicht({ ...stand.zicht, sectionBox: { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } } }));
    await wacht(120);
    wijzer("pointermove", { x: bij7.x + 4, y: bij7.y });
    await wacht(60);
    ok(tekenvlak().dataset.openFem3dTekenpunt !== "knoop", `met doos geen knoopsnap buiten de doos: ${tekenvlak().dataset.openFem3dTekenpunt}`);
    const bij3 = scherm([6, 0, 3]);
    wijzer("pointermove", { x: bij3.x + 3, y: bij3.y });
    await wacht(60);
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "knoop", "knoop 3 binnen de doos");
    ok(Number(tekenvlak().dataset.openFem3dNodeSnapIndexed) === 4, `de snapindex telt de vier knopen binnen: ${tekenvlak().dataset.openFem3dNodeSnapIndexed}`);
  });

  await test("labels: het knoopnummer van knoop 7 (buiten) verdwijnt, dat van knoop 3 (binnen) blijft", async () => {
    await begin(portalen(), { ...ZICHT, nodeNumbers: true });
    const label = (id: string) => [...container.querySelectorAll<HTMLElement>(".open-fem3d-node-label")].find((el) => el.textContent === id)!;
    ok(label("7") && label("7").style.display !== "none", "zonder doos: knoop 7 gelabeld");
    flushSync(() => zet.zicht({ ...stand.zicht, sectionBox: { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } } }));
    await wacht(120);
    gelijk([label("7").style.display, label("3").style.display], ["none", ""], "met doos");
    gelijk(tekenvlak().dataset.openFem3dSectionBoxLabelsBuiten, "4", "vier labels buiten de doos (knopen 5–8)");
  });

  await test("passend beeld past op de doos (ingeperkt tot het model): het doel schuift naar y ≈ 1,5 m", async () => {
    await begin();
    await menu("passend");
    const y0 = Number((tekenvlak().dataset.openFem3dCameraTarget ?? "").split(",")[1]);
    ongeveer(y0, 3, 0.05, "zonder doos: het midden van het model");
    flushSync(() => zet.zicht({ ...stand.zicht, sectionBox: { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } } }));
    await wacht(120);
    await menu("passend");
    const y1 = Number((tekenvlak().dataset.openFem3dCameraTarget ?? "").split(",")[1]);
    ok(y1 > 1.2 && y1 < 1.7, `met doos: het midden van wat binnen de doos ligt (${y1})`);
  });

  await test("Reset en passend op selectie uit het menu; Esc tijdens het slepen zet de doos terug op het model", async () => {
    await begin();
    flushSync(() => zet.zicht({ ...stand.zicht, sectionBox: { enabled: true, bounds: { min: [1, 1, 1], max: [2, 2, 2] } } }));
    await wacht(120);
    await menu("sectionBoxReset");
    gelijk(doos(), { enabled: true, bounds: MODELDOOS }, "Reset");
    flushSync(() => zet.selectie({ type: "beam", id: 2 }));
    await wacht(60);
    gelijk(menuItemEl("sectionBoxSelectie").getAttribute("aria-disabled"), null, "met selectie te kiezen");
    await menu("sectionBoxSelectie");
    gelijk(doos(), { enabled: true, bounds: { min: [-0.9, -0.9, 2.1], max: [6.9, 0.9, 3.9] } }, "om staaf 2");
    await sleep("+x", (g) => [g.x - 2, g.y, g.z], 4, false);
    ok(tekenvlak().dataset.openFem3dSectionBoxSleept === "+x", "aan het slepen");
    toets("Escape");
    await wacht(80);
    gelijk(doos(), { enabled: true, bounds: MODELDOOS }, "Esc: de modelgrenzen");
    gelijk([tekenvlak().dataset.openFem3dEscape, stand.tool], ["sectionBoxReset", "select"], "Esc raakt het gereedschap niet");
    ok(tekenvlak().dataset.openFem3dSectionBoxSleept === undefined, "niet meer aan het slepen");
  });

  await test("grepen in de eerste render na aan, passend op selectie en Reset op hun vlak (de getekende wereldmatrix)", async () => {
    await begin();
    // Elke greep meldt de wereldmatrix waarmee hij echt getekend wordt; per
    // actie telt alleen de eerste render erna (geen extra render in de proef).
    const getekend = new Map<string, THREE.Matrix4>();
    for (const vlak of OPEN_FEM_3D_SECTION_BOX_VLAKKEN) {
      const g = greep(vlak.id);
      g.onBeforeRender = () => { if (!getekend.has(vlak.id)) getekend.set(vlak.id, g.matrixWorld.clone()); };
    }
    const controleer = async (actie: string) => {
      if (menuEl().hidden) klikEcht(menuKnopEl(), "knop ▾");
      await wacht(40);
      getekend.clear();
      klikEcht(menuItemEl(actie), `menu-item ${actie}`);
      await wacht(80);
      const b = doos().bounds!;
      ok(doos().enabled && b, `${actie}: doos aan`);
      let getoond = 0;
      for (const vlak of OPEN_FEM_3D_SECTION_BOX_VLAKKEN) {
        const m = getekend.get(vlak.id);
        if (!greep(vlak.id).visible) continue;
        ok(m, `${actie}: greep ${vlak.id} getekend`);
        getoond += 1;
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), schaal = new THREE.Vector3();
        m!.decompose(p, q, schaal);
        const lengte = greep(vlak.id).scale.y;
        ongeveer(schaal.y, lengte, 1e-9, `${actie}: getekende maat van ${vlak.id}`);
        const midden = openFem3DSectionBoxVlakMidden(b, vlak);
        const verwacht = new THREE.Vector3(...midden);
        verwacht.setComponent(vlak.as, midden[vlak.as] + vlak.kant * (lengte / 2 + lengte * 3 / OPEN_FEM_3D_SECTION_BOX_GREEP_PX));
        const a = scherm([p.x, p.y, p.z]), e = scherm([verwacht.x, verwacht.y, verwacht.z]);
        ok(Math.hypot(a.x - e.x, a.y - e.y) < 0.5 && p.distanceTo(verwacht) < 1e-6,
          `${actie}: greep ${vlak.id} getekend op ${p.toArray().map((v) => v.toFixed(3))}, hoort op ${verwacht.toArray().map((v) => v.toFixed(3))} `
          + `(${Math.hypot(a.x - e.x, a.y - e.y).toFixed(0)} px ernaast)`);
      }
      ok(getoond >= 4, `${actie}: ${getoond} grepen getoond`);
    };
    await controleer("sectionBox");
    flushSync(() => zet.selectie({ type: "beam", id: 2 }));
    await wacht(60);
    await controleer("sectionBoxSelectie");
    gelijk(doos().bounds, { min: [-0.9, -0.9, 2.1], max: [6.9, 0.9, 3.9] }, "om staaf 2");
    await controleer("sectionBoxReset");
    gelijk(doos().bounds, MODELDOOS, "Reset");
  });

  await test("recht van boven: de grepen ±z wijzen naar de kijker — niet getekend, geen handje; een klik midden in de doos kiest de ligger (perspectief en parallel)", async () => {
    // Ligger 9 van (0; 3; 3) naar (6; 3; 3): precies onder het midden van de doos.
    await begin(bouw([...KNOPEN, [0, 3, 3], [6, 3, 3]], [...STAVEN, [9, 10]]));
    await menu("sectionBox");
    gelijk(doos().bounds, MODELDOOS, "de doos om het model");
    for (const projectie of ["perspectief", "parallel"]) {
      if (projectie === "parallel") {
        await menu("perspectief");
        gelijk(stand.zicht.perspective, false, "parallel");
      }
      const midden = scherm([3, 3, 3]);
      gelijk([greep("+z").visible, greep("-z").visible], [false, false], `${projectie}: ±z niet getekend`);
      ok(greep("+x").visible && greep("+y").visible, `${projectie}: ±x en ±y wel`);
      wijzer("pointermove", midden);
      await wacht(40);
      gelijk([tekenvlak().dataset.openFem3dSectionBoxGreep ?? "", canvas3d().style.cursor], ["", ""], `${projectie}: geen greep onder de muis, geen handje`);
      flushSync(() => zet.selectie(null));
      await wacht(40);
      await klik(midden);
      gelijk(stand.selectie, { type: "beam", id: 9 }, `${projectie}: de klik kiest de ligger`);
      ok(tekenvlak().dataset.openFem3dSectionBoxSleept === undefined, `${projectie}: geen sleep begonnen`);
    }
  });

  await test("een dakplaat (z = 3 m): het deel buiten de doos niet in beeld en niet kiesbaar, binnen wel; plaat en randen hebben de vlakken", async () => {
    await begin(bouw(KNOPEN, STAVEN, [[2, 3, 7, 6]]));
    const wit = beeldpunt(scherm([-2, 3, 3]));
    const verschil = (a: number[], b: number[]) => a.reduce((som, v, i) => som + Math.abs(v - b[i]!), 0);
    const binnen = scherm([1.5, 1.5, 3]), buiten = scherm([1.5, 4.5, 3]);
    info.push(`dakplaat: achtergrond ${wit}, zonder doos binnen ${beeldpunt(binnen)} en buiten ${beeldpunt(buiten)}`);
    ok(verschil(beeldpunt(buiten), wit) > 20, `zonder doos is de plaat bij y = 4,5 m in beeld: ${beeldpunt(buiten)} tegen ${wit}`);
    flushSync(() => zet.zicht({ ...stand.zicht, sectionBox: { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } } }));
    await wacht(120);
    info.push(`dakplaat met doos tot y = 3 m: binnen ${beeldpunt(binnen)}, buiten ${beeldpunt(buiten)}`);
    ok(verschil(beeldpunt(buiten), wit) <= 6, `met doos is de plaat bij y = 4,5 m weg: ${beeldpunt(buiten)} tegen ${wit}`);
    ok(verschil(beeldpunt(binnen), wit) > 20, `met doos blijft de plaat bij y = 1,5 m: ${beeldpunt(binnen)}`);
    const plaatDelen: THREE.Object3D[] = [];
    renderScene?.traverse((o) => {
      if (o.userData.type === "plate" && (o as THREE.Mesh).material) plaatDelen.push(o);
    });
    ok(plaatDelen.length >= 2, `plaat en randen in de scène: ${plaatDelen.length}`);
    for (const deel of plaatDelen) {
      const vlakken = ((deel as THREE.Mesh).material as THREE.Material).clippingPlanes;
      gelijk(vlakken?.length ?? 0, 6, `${deel.type} van de plaat heeft de zes vlakken`);
    }
    await klik(buiten);
    gelijk(stand.selectie, null, "klik op het weggeknipte deel: niets");
    await klik(binnen);
    gelijk(stand.selectie, { type: "plate", id: 1 }, "klik op het deel binnen de doos: de plaat");
  });

  await test("objectspoor: een verworven knoop die na het slepen van een vlak buiten de doos valt, geeft geen spoor meer", async () => {
    // Knopen (0; 0; 0), (4; 0; 0) en (8; 8; 0); recht van boven.
    mount(<Werkruimte begin={bouw([[0, 0, 0], [4, 0, 0], [8, 8, 0]], [])}
      camera={{ position: [4, 4, 30], target: [4, 4, 0], up: [0, 1, 0] }} />);
    await wacht(300);
    await menu("sectionBox");
    flushSync(() => zet.tool("addBeam"));
    await wacht(80);
    await klik(scherm([0, 0, 0]));
    gelijk(stand.selectie, { type: "node", id: 1 }, "beginpunt knoop 1");
    wijzer("pointermove", scherm([8, 8, 0]));
    await wacht(650);
    ok(verworven().includes("knoop:3"), `knoop 3 verworven: ${verworven()}`);
    const naastSpoor = () => { const p = scherm([8, 2, 0]); return { x: p.x + 3, y: p.y }; };
    wijzer("pointermove", naastSpoor());
    await wacht(60);
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "spoor", "vóór het slepen: het spoor van knoop 3");
    // Het vlak +y naar y ≈ 3,5 m: knoop 3 (y = 8) valt buiten de doos.
    await sleep("+y", (g) => [g.x, g.y - (doos().bounds!.max[1] - 3.5), g.z], 6);
    const maxY = doos().bounds!.max[1];
    ok(maxY > 2.5 && maxY < 7, `+y versleept: ${maxY}`);
    ok(!verworven().includes("knoop:3"), `knoop 3 niet meer verworven: ${verworven()}`);
    wijzer("pointermove", naastSpoor());
    await wacht(60);
    ok(tekenvlak().dataset.openFem3dTekenpunt !== "spoor", `na het slepen geen spoor van knoop 3: ${tekenvlak().dataset.openFem3dTekenpunt}`);
  });

  await test("een opgeslagen view bewaart de doos; toepassen zet hem terug", async () => {
    await begin();
    flushSync(() => zet.zicht({ ...stand.zicht, sectionBox: { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } } }));
    await wacht(120);
    flushSync(() => zet.vensterOpen(true));
    await wacht(80);
    const opslaan = [...document.querySelectorAll<HTMLButtonElement>(".open-fem3d-viewset-save button")][0];
    ok(opslaan && !opslaan.disabled, "knop Opslaan");
    flushSync(() => opslaan.click());
    await wacht(60);
    gelijk(stand.views.length, 1, "een view");
    gelijk(stand.views[0].visibility.sectionBox, { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } }, "de doos in de view");
    flushSync(() => zet.vensterOpen(false));
    await menu("sectionBox");
    gelijk(doos().enabled, false, "uit");
    flushSync(() => zet.vensterOpen(true));
    await wacht(80);
    flushSync(() => document.querySelector<HTMLButtonElement>(".open-fem3d-viewset-apply")!.click());
    await wacht(120);
    gelijk(doos(), { enabled: true, bounds: { min: [-0.9, -0.9, -0.9], max: [6.9, 3, 3.9] } }, "terug uit de view");
    gelijk(tekenvlak().dataset.openFem3dSectionBox, "-0.9,-0.9,-0.9;6.9,3,3.9", "in het tekenvlak");
    flushSync(() => zet.vensterOpen(false));
  });
  }

  if (groep !== "basis") await test("prestatie in een hal van 631 staven: twintig sleepstappen zonder opbouw en zonder nieuwe shader", async () => {
    const model = hal();
    info.push(`hal: ${model.nodes.length} knopen, ${model.beams.length} staven`);
    mount(<Werkruimte begin={model} zicht={{ ...ZICHT, profiles: true }}
      camera={{ position: [-25, -40, 35], target: [21, 15, 4], up: [0, 0, 1] }} />);
    await wacht(400);
    await menu("sectionBox");
    const voor = geschiedenis().length;
    const programmas = renderRenderer!.info.programs?.length ?? 0;
    await sleep("+x", (g) => [g.x - 20, g.y, g.z], 20);
    const b = doos().bounds!;
    ok(b.max[0] < 35 && b.max[0] > 18, `+x versleept: ${b.max[0]}`);
    ok(!geschiedenis().slice(voor).some((m) => m.startsWith("full")), `geen volledige opbouw: ${geschiedenis().join(",")}`);
    gelijk(renderRenderer!.info.programs?.length ?? 0, programmas, "geen nieuwe shader");
    ok(Number(tekenvlak().dataset.openFem3dSectionBoxSleepstappen) >= 10, `stappen: ${tekenvlak().dataset.openFem3dSectionBoxSleepstappen}`);
    info.push(`hal: ${tekenvlak().dataset.openFem3dSectionBoxMaterialen} geknipte materialen, `
      + `doorloop ${tekenvlak().dataset.openFem3dSectionBoxSyncMs} ms, stap ${tekenvlak().dataset.openFem3dSectionBoxStapMs} ms (virtuele tijd)`);
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  // Geen schuifbalk (de uitslag onder de werkruimte): het venster is precies de werkruimte.
  document.body.style.overflow = "hidden";
  const model = hal();
  mount(<Werkruimte begin={model} zicht={{ ...ZICHT, profiles: true, grid: true, axes: true }}
    camera={{ position: [-26, -42, 36], target: [21, 15, 3], up: [0, 0, 1] }}
    breed={window.innerWidth} hoog={window.innerHeight} />);
  await wacht(400);
  await menu("sectionBox");
  // Het voorste stuk van de hal weg: de doos begint bij x = 13 m (een spant
  // halverwege een vak, zodat de gordingen er afgesneden uitsteken).
  await sleep("-x", (g) => [g.x + 18, g.y, g.z], 6);
  await menu("passend");
  const g = greep("+y").position;
  wijzer("pointermove", scherm([g.x, g.y, g.z]));
  await wacht(80);
  if (beeld === "menu") klikEcht(menuKnopEl(), "knop ▾");
}

run()
  .then(() => {
    // Na de proeven het tekenvlak weg: anders rendert de laatste werkruimte door
    // tot het virtuele tijdbudget op is. Niet in de beeldstand (#beeld=…).
    if (!location.hash.includes("beeld=")) flushSync(() => root.unmount());
    const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, info, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, info, error: String(e?.stack ?? e) }); });
