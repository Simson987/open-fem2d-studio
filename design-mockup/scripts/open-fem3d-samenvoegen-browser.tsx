/**
 * Browserkant van test-open-fem3d-samenvoegen-ui.mjs: knopen samenvoegen
 * (issue #75) in de echte 3D-werkruimte (OpenFem3DEditor met ThreeFrameCanvas,
 * WebGL), met echte klikken op het tekenvlak, het paneel Verplaatsen, de
 * modelcontrole en het lint. De werkruimte bewaart het model in de echte
 * historie (openFem3dHistoryReducer) en roept dezelfde stappen aan als
 * App.tsx, met de snapinstellingen zoals ze zijn:
 * `openFem3DEditWithAutoConnect` voor elke bewerking (App.setOpenFem3d, met de
 * stap terug voor de selectie na een transformatie), `openFem3DMergeButton`
 * voor de knop Samenvoegen in de modelcontrole ("model") en de lintknop
 * ("selectie", App.handleOpenFem3DMergeNodes), en de melding met
 * `openFem3DMergeMessage` (App.meldOpenFem3DSamenvoegen) als toast.
 *
 * Bewaakt:
 *  - de modelcontrole: "3 knopen vallen samen met een andere knoop", een
 *    regel per groep ("Knoop 5 valt samen met knoop 2 (2 mm).") en de knop
 *    Samenvoegen; die voegt in één stap samen, de kaart verdwijnt, ongedaan
 *    maken brengt alles terug; staan er ook knopen op staven, dan twee
 *    kopregels met elk hun knop; een te brede groep: de reden en de knop uit;
 *  - het lint: Knopen samenvoegen in de groep Bewerken, met zijn uitleg;
 *    zonder selectie het hele model, met een knoop geselecteerd alleen zijn
 *    groep, één stap, met de samenvatting als melding, die de gebruikte
 *    tolerantie noemt (ook als de verbindingstolerantie 20 mm is);
 *  - automatisch bij tekenen (rastersnap, knoopsnap uit): een staaf die 3 mm
 *    naast knoop 4 begint, begint op knoop 4; de volgende staaf gaat verder
 *    vanaf het nieuwe eindpunt en eindigt 3 mm naast knoop 5 op knoop 5; met
 *    de schakelaar uit komt er een knoop naast, en meldt de modelcontrole hem;
 *  - tekenen op het voetpunt van een staaf 3 mm van haar begin: de nieuwe
 *    staaf begint op die beginknoop, de staaf wordt niet gesplitst en houdt
 *    haar puntlast;
 *  - verplaatsen (paneel Verplaatsen) tot 2 mm naast een knoop: de
 *    verplaatste knoop wordt die knoop, de selectie ook; midden tussen twee
 *    knopen die 8 mm uit elkaar liggen: hij gaat op in één ervan, de andere
 *    (met de kolom erop) blijft;
 *  - de modelcontrole noemt bij een weigering om levels de levels bij naam en
 *    hoogte.
 *
 * `#beeld=lint` en `#beeld=kaart` tonen alleen een beeld, voor een
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
import "../src/components/ribbon/Ribbon.css";
import "../src/components/fem/FemProjectTree.css";
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import HomeTab from "../src/components/ribbon/HomeTab";
import ToastHost, { pushToast } from "../src/components/feedback/Toast";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { openFem3DConnectButton, openFem3DEditWithAutoConnect } from "../src/components/openFem3d/openFem3dAansluiten";
import {
  openFem3DMergeButton, openFem3DMergeMessage, type OpenFem3DMergeMessagePart, type OpenFem3DMergeStep,
} from "../src/components/openFem3d/openFem3dSamenvoegen";
import { openFem3dHistoryReducer, type OpenFem3DEditMeta, type OpenFem3DHistory } from "../src/components/openFem3d/openFem3dHistory";
import { herstelSnapBeginstand, leesSnapInstellingen, zetKnopenAansluiten, zetSnap, zetVerbindingsTolerantie } from "../src/hooks/useSnapInstellingen";
import type { StructuralGrid } from "../src/components/fem/femTypes";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DTool } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};
// Headless met virtuele tijd tekent geen beeldjes: animatieframes via een timer.
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);

// De camera waarmee het tekenvlak echt tekent (zoals in open-fem3d-aansluiten-browser.tsx).
let renderCamera: THREE.Camera | null = null;
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  set(this: THREE.WebGLRenderer, fn: (scene: THREE.Object3D, camera: THREE.Camera) => void) {
    Object.defineProperty(this, "render", {
      configurable: true, writable: true,
      value: (scene: THREE.Object3D, cam: THREE.Camera) => { renderCamera = cam; return fn.call(this, scene, cam); },
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
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
  herstelSnapBeginstand();
}

/* ── Model en werkruimte ──────────────────────────────────────────────── */

const leeg = { supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [] };
/**
 * Twee platen die apart getekend zijn: plaat 1 (knopen 1–4) van (0; 0) tot
 * (4; 3), plaat 2 (5–8) van (4; 0) tot (8; 3), met knoop 5 2 mm en knoop 8
 * 3 mm naast de hoeken 2 en 3. Een kolom (staaf 1, 9 → 10) eronder met haar kop
 * 10 op (4,002; 2,998; 0), via hoek 3 in dezelfde groep.
 */
function tweePlaten(): OpenFem3DModel {
  return parseOpenFem3DModel({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 4, y: 3, z: 0 }, { id: 4, x: 0, y: 3, z: 0 },
      { id: 5, x: 4.002, y: 0, z: 0 }, { id: 6, x: 8, y: 0, z: 0 }, { id: 7, x: 8, y: 3, z: 0 }, { id: 8, x: 4, y: 3.003, z: 0 },
      { id: 9, x: 4.002, y: 2.998, z: -3 }, { id: 10, x: 4.002, y: 2.998, z: 0 },
    ],
    beams: [{ id: 1, startNodeId: 9, endNodeId: 10, profileName: "HEA 200", material: "S235" }],
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2 }, { id: 2, nodeIds: [5, 6, 7, 8], thicknessM: 0.2 }],
    supports: [{ nodeId: 9, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], surfaceLoads: [],
  });
}
const ZICHT: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY,
  grid: false, axes: false, structuralGrid: false, levelMarks: false, nodeNumbers: false, viewCube: false,
  deformation: false, reactions: false, utilization: false,
};
/** Recht van boven op het werkvlak (z = 0), schuin genoeg voor perspectief. */
const BOVEN: OpenFem3DCameraState = { position: [4, 1.5, 16], target: [4, 1.5, 0], up: [0, 1, 0] };
const SCHUIN: OpenFem3DCameraState = { position: [1, -9, 8], target: [4, 1.5, -0.8], up: [0, 0, 1] };

/** De melding na samenvoegen, zoals App.meldOpenFem3DSamenvoegen (met de levels), als toast (`duur` voor een schermafbeelding). */
function meld(stap: OpenFem3DMergeStep, duur?: number, levels: StructuralGrid["zAxes"] = []) {
  const message = openFem3DMergeMessage(stap.result, stap.context, levels);
  const tekst = (part: OpenFem3DMergeMessagePart) => i18next.t(part.key, {
    ...(part.values ?? {}),
    ...(part.count === undefined ? {} : { count: part.count }),
    ...Object.fromEntries(Object.entries(part.lists ?? {}).map(([naam, sleutels]) => [naam, sleutels.map((s) => i18next.t(s)).join(", ")])),
  });
  pushToast({ kind: message.level, title: tekst(message.title), body: message.details.map(tekst).join(" "), ...(duur ? { duration: duur } : {}) });
}

interface Stand { model: OpenFem3DModel; stappen: number; history: OpenFem3DHistory; selectie: OpenFem3DSelection; samengevoegd: number[] }
let stand: Stand;
let doe: { undo: () => void; gereedschap: (tool: OpenFem3DTool) => void };

function Werkruimte({ begin, camera = BOVEN, zicht = ZICHT, tool = "select", beginSelectie = null, breedte = 900, lint = false, toastDuur, stramien }: {
  begin: OpenFem3DModel; camera?: OpenFem3DCameraState; zicht?: OpenFem3DVisibility; tool?: OpenFem3DTool;
  beginSelectie?: OpenFem3DSelection; breedte?: number; lint?: boolean; toastDuur?: number; stramien?: StructuralGrid;
}) {
  const [history, setHistory] = React.useState<OpenFem3DHistory>({ model: begin, past: [], future: [] });
  const [gereedschap, setGereedschap] = React.useState<OpenFem3DTool>(tool);
  const [selectie, setSelectieState] = React.useState<OpenFem3DSelection>(beginSelectie);
  const historyRef = React.useRef(history);
  historyRef.current = history;
  const selectieRef = React.useRef(selectie);
  const setSelectie = (next: OpenFem3DSelection) => { selectieRef.current = next; setSelectieState(next); };
  const samengevoegd = React.useRef<number[]>([]);
  const zet = (next: OpenFem3DHistory) => { historyRef.current = next; setHistory(next); };
  // Zoals App.setOpenFem3d: samenvoegen en aansluiten in dezelfde stap, met de stap terug.
  const wijzig = (next: OpenFem3DModel, meta?: OpenFem3DEditMeta) => {
    const stap = openFem3DEditWithAutoConnect(historyRef.current.model, next, leesSnapInstellingen(), meta?.historyGroup);
    samengevoegd.current.push(stap.merge?.nodeCount ?? 0);
    zet(openFem3dHistoryReducer(historyRef.current, { type: "edit", model: stap.model, ...meta }));
    return stap;
  };
  // Zoals App.handleOpenFem3DMergeNodes: "model" (de knop in de modelcontrole) en "selectie" (de lintknop).
  const voegSamen = (bereik: "selectie" | "model") => {
    const stap = openFem3DMergeButton(historyRef.current.model, selectieRef.current, leesSnapInstellingen(), bereik);
    if (stap.model !== historyRef.current.model) zet(openFem3dHistoryReducer(historyRef.current, { type: "edit", model: stap.model }));
    meld(stap, toastDuur, stramien?.zAxes);
  };
  // Zoals App.handleOpenFem3DConnectNodes("model").
  const sluitAan = () => {
    const stap = openFem3DConnectButton(historyRef.current.model, selectieRef.current, leesSnapInstellingen(), "model");
    if (stap.model !== historyRef.current.model) zet(openFem3dHistoryReducer(historyRef.current, { type: "edit", model: stap.model }));
  };
  stand = { model: history.model, stappen: history.past.length, history, selectie, samengevoegd: samengevoegd.current };
  doe = {
    undo: () => zet(openFem3dHistoryReducer(historyRef.current, { type: "undo" })),
    gereedschap: setGereedschap,
  };
  const editor = (
    <div style={{ display: "flex", width: breedte, height: 560, position: "relative" }}>
      <OpenFem3DEditor model={history.model} onChange={wijzig} visibility={zicht}
        tool={gereedschap} onToolChange={setGereedschap} selection={selectie} onSelectionChange={setSelectie}
        onConnectNodes={sluitAan} onMergeNodes={() => voegSamen("model")}
        showLoadCase activeLoadCaseId={1} initialCamera={camera} gridSpacingM={0.5} structuralGrid={stramien} />
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--theme-bg)" }}>
      {lint && (
        // Zoals Ribbon.tsx het lint zet: container, wrapper en paneel.
        <div className="ribbon-container" style={{ flex: "none", marginTop: 0 }}>
          <div className="ribbon-content-wrapper"><div className="ribbon-content-panel">
            <HomeTab modelDimension="3d" onOpenFem3DMergeNodes={() => voegSamen("selectie")} onOpenFem3DConnectNodes={sluitAan}
              canOpenFem3DDelete />
          </div></div>
        </div>
      )}
      {editor}
      <ToastHost />
    </div>
  );
}

const canvas3d = () => container.querySelector<HTMLCanvasElement>(".open-fem3d-canvas canvas")!;
const kaart = () => container.querySelector<HTMLElement>(".open-fem3d-model-check");
const regels = () => [...container.querySelectorAll<HTMLElement>(".open-fem3d-model-check-lijst li")].map((li) => li.textContent ?? "");
const samenvoegKnop = () => container.querySelector<HTMLButtonElement>("[data-open-fem3d-merge-nodes]");
const aansluitKnop = () => container.querySelector<HTMLButtonElement>("[data-open-fem3d-connect-nodes]");
const lintKnop = () => [...container.querySelectorAll<HTMLButtonElement>("button.ribbon-btn")]
  .find((b) => b.querySelector(".ribbon-btn-label")?.textContent === "Knopen samenvoegen");
const toast = () => container.querySelector<HTMLElement>(".toast");
const ketting = (m: OpenFem3DModel) => m.beams.map((b) => [b.id, b.startNodeId, b.endNodeId]);
const knoopIds = (m: OpenFem3DModel) => m.nodes.map((n) => n.id);

type Punt = [number, number, number];
/** Schermpunt (client) van een wereldpunt, met de camera waarmee het tekenvlak tekent. */
function scherm(p: Punt): { x: number; y: number } {
  ok(renderCamera, "er is getekend");
  renderCamera!.updateMatrixWorld();
  const rect = canvas3d().getBoundingClientRect();
  const n = new THREE.Vector3(...p).project(renderCamera!);
  return { x: rect.left + (n.x + 1) / 2 * rect.width, y: rect.top + (1 - n.y) / 2 * rect.height };
}
/** De aanwijzer naar dit punt bewegen, zonder klik (een staaf verwerven voor het objectspoor). */
async function wijs(punt: { x: number; y: number }) {
  const basis = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: punt.x, clientY: punt.y };
  flushSync(() => canvas3d().dispatchEvent(new PointerEvent("pointermove", { ...basis, button: -1, buttons: 0 })));
  await wacht(60);
}
/** Een echte klik (aanwijzer bewegen, neer en op dezelfde plek) op het WebGL-canvas. */
async function klik(punt: { x: number; y: number }) {
  const canvas = canvas3d();
  const basis = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: punt.x, clientY: punt.y };
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointermove", { ...basis, button: -1, buttons: 0 })));
  await wacht(60);
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointerdown", { ...basis, button: 0, buttons: 1 })));
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointerup", { ...basis, button: 0, buttons: 0 })));
  await wacht(120);
}
/** Een waarde in een React-invoerveld zetten zoals typen dat doet. */
function typ(el: HTMLInputElement | undefined, waarde: string) {
  ok(el, "invoerveld ontbreekt");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el!.dispatchEvent(new Event("input", { bubbles: true })));
}

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  document.documentElement.setAttribute("data-theme", "light");
  try { localStorage.clear(); } catch { /* privé venster */ }
  herstelSnapBeginstand();
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("de modelcontrole: samenvallende knopen met de knop Samenvoegen; één stap, de kaart verdwijnt, ongedaan maken brengt hem terug", async () => {
    mount(<Werkruimte begin={tweePlaten()} />);
    await wacht(400);
    ok(kaart(), "de modelcontrole staat in beeld bij het openen");
    gelijk(kaart()!.querySelector(".open-fem3d-model-check-toggle")?.textContent?.replace(/[▾▸!]/g, "").trim(),
      "3 knopen vallen samen met een andere knoop", "kop");
    gelijk(regels(), ["Knoop 5 valt samen met knoop 2 (2 mm).", "Knopen 8, 10 vallen samen met knoop 3 (tot 3 mm)."], "een regel per groep");
    ok(samenvoegKnop() && !samenvoegKnop()!.disabled, "de knop Samenvoegen staat aan");
    gelijk(samenvoegKnop()!.textContent, "Samenvoegen", "de knop");
    ok((samenvoegKnop()!.title ?? "").includes("binnen 5 mm"), `uitleg bij de knop met de tolerantie: ${samenvoegKnop()!.title}`);
    ok(!aansluitKnop(), "geen knop Aansluiten (geen knoop op een staaf)");
    gelijk(stand.stappen, 0, "openen verandert het model niet");
    flushSync(() => samenvoegKnop()!.click());
    await wacht();
    gelijk(knoopIds(stand.model), [1, 2, 3, 4, 6, 7, 9], "5, 8 en 10 zijn opgegaan in 2 en 3");
    gelijk(stand.model.plates?.find((p) => p.id === 2)?.nodeIds, [2, 6, 7, 3], "plaat 2 deelt de rand 2–3 met plaat 1");
    gelijk(ketting(stand.model), [[1, 9, 3]], "de kolom hangt aan hoek 3");
    gelijk(stand.stappen, 1, "één stap ongedaan maken");
    ok(!kaart(), "de kaart is weg");
    ok((toast()?.textContent ?? "").includes("3 knopen samengevoegd"), `de samenvatting als melding: ${toast()?.textContent}`);
    flushSync(() => doe.undo());
    await wacht();
    ok(kaart() && regels().length === 2 && stand.model.nodes.length === 10, "na ongedaan maken staat alles er weer");
  });

  await test("beide soorten in de modelcontrole: twee kopregels, elk met hun knop", async () => {
    // Staaf 1 van 1 naar 2 met een losse knoop 3 erop; knoop 5 ligt 2 mm naast knoop 4.
    mount(<Werkruimte begin={parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 0 }, { id: 4, x: 2, y: 3, z: 0 }, { id: 5, x: 2.002, y: 3, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }], ...leeg,
    })} />);
    await wacht(400);
    gelijk(regels(), ["Knoop 3 ligt op staaf 1 maar is niet verbonden.", "Knoop 5 valt samen met knoop 4 (2 mm)."], "beide regels");
    gelijk([...kaart()!.querySelectorAll(".open-fem3d-model-check-kop")].map((k) => k.textContent?.replace(/[▾▸!]/g, "").trim()),
      ["1 knoop ligt op een staaf zonder verbindingAansluiten", "1 knoop valt samen met een andere knoopSamenvoegen"], "twee kopregels met hun knop");
    flushSync(() => samenvoegKnop()!.click());
    await wacht();
    gelijk(regels(), ["Knoop 3 ligt op staaf 1 maar is niet verbonden."], "na Samenvoegen blijft alleen de knoop op de staaf");
    ok(aansluitKnop() && !samenvoegKnop(), "de knop Samenvoegen is weg, Aansluiten staat er nog");
  });

  await test("een groep breder dan 2 × de tolerantie: de reden in de regel, de knop Samenvoegen uit", async () => {
    mount(<Werkruimte begin={parseOpenFem3DModel({ nodes: [0, 1, 2, 3].map((i) => ({ id: i + 1, x: i * 0.004, y: 0, z: 0 })), beams: [], ...leeg })} />);
    await wacht(300);
    gelijk(regels(), ["Knopen 1, 2, 3, 4: de groep is 12 mm breed, meer dan 2 × de tolerantie (10 mm); zo ver mag een verbinding niet verschuiven. Voeg ze per selectie samen of verklein de tolerantie."],
      "de regel met de reden");
    ok(samenvoegKnop()?.disabled, "de knop staat uit");
    ok((samenvoegKnop()?.title ?? "").startsWith("Niets samen te voegen"), `uitleg: ${samenvoegKnop()?.title}`);
  });

  await test("het lint: Knopen samenvoegen in de groep Bewerken; zonder selectie het hele model, met knoop 5 geselecteerd alleen zijn groep", async () => {
    mount(<Werkruimte begin={tweePlaten()} lint beginSelectie={{ type: "node", id: 5 }} />);
    await wacht(400);
    const knop = lintKnop();
    ok(knop && !knop.disabled, "de knop staat in het lint");
    ok(knop!.closest(".ribbon-group")?.querySelector(".ribbon-group-label")?.textContent === "Bewerken", "in de groep Bewerken");
    ok((knop!.title ?? "").startsWith("Knopen samenvoegen: knopen die binnen de verbindingstolerantie"), `uitleg: ${knop!.title}`);
    flushSync(() => knop!.click());
    await wacht();
    gelijk(knoopIds(stand.model), [1, 2, 3, 4, 6, 7, 8, 9, 10], "met knoop 5 geselecteerd: alleen 5 → 2");
    ok((toast()?.textContent ?? "").includes("Binnen de selectie (1 knoop, staaf of plaat), met een tolerantie van 5 mm."),
      `de melding noemt de selectie en de tolerantie: ${toast()?.textContent}`);
    gelijk(stand.stappen, 1, "één stap");
    mount(<Werkruimte begin={tweePlaten()} lint />);
    await wacht(300);
    flushSync(() => lintKnop()!.click());
    await wacht();
    gelijk(knoopIds(stand.model), [1, 2, 3, 4, 6, 7, 9], "zonder selectie: het hele model");
    gelijk(stand.stappen, 1, "één stap");
    ok((toast()?.textContent ?? "").includes("In het hele model, met een tolerantie van 5 mm."), `de melding: ${toast()?.textContent}`);
  });

  await test("de lintknop met de verbindingstolerantie op 20 mm: knopen 15 mm uit elkaar gaan samen, de melding noemt 20 mm", async () => {
    zetVerbindingsTolerantie(20);
    mount(<Werkruimte begin={parseOpenFem3DModel({ nodes: [{ id: 1, x: 2, y: 0, z: 0 }, { id: 2, x: 2.015, y: 0, z: 0 }], beams: [], ...leeg })} lint />);
    await wacht(300);
    flushSync(() => lintKnop()!.click());
    await wacht();
    gelijk(knoopIds(stand.model), [1], "knoop 2 is opgegaan in knoop 1");
    const tekst = toast()?.textContent ?? "";
    ok(tekst.includes("1 knoop samengevoegd") && tekst.includes("In het hele model, met een tolerantie van 20 mm."), `de melding: ${tekst}`);
  });

  await test("automatisch bij tekenen (rastersnap, knoopsnap uit): de staaf begint op knoop 4 die 3 mm naast het rasterpunt ligt, en gaat verder tot knoop 5", async () => {
    zetSnap("knoop", false);
    zetSnap("spoor", false);
    // Knopen 4 en 5 liggen 3 mm naast de rasterpunten (2; 3) en (6; 3).
    const begin = parseOpenFem3DModel({
      nodes: [{ id: 4, x: 2.003, y: 3, z: 0 }, { id: 5, x: 6.003, y: 3, z: 0 }], beams: [], ...leeg,
    });
    mount(<Werkruimte begin={begin} tool="addBeam" />);
    await wacht(400);
    await klik(scherm([2, 3, 0]));
    gelijk(container.querySelector<HTMLElement>("[data-open-fem3d-samengevoegd]")?.dataset.openFem3dSamengevoegd, "4",
      "de eerste klik is knoop 4 (het tekenvlak hergebruikt hem)");
    await klik(scherm([4, 3, 0]));
    await klik(scherm([6, 3, 0]));
    const nieuw = stand.model.nodes.filter((n) => n.id > 5);
    gelijk(nieuw.map((n) => [n.x, n.y, n.z]), [[4, 3, 0]], "alleen de tussenknoop op (4; 3) is nieuw");
    gelijk(ketting(stand.model), [[1, 4, nieuw[0].id], [2, nieuw[0].id, 5]], "de staven lopen 4 → nieuw → 5");
    ok(!kaart(), "geen samenvallende knopen in de modelcontrole");
    zetKnopenAansluiten(false);
    mount(<Werkruimte begin={begin} tool="addBeam" />);
    await wacht(400);
    await klik(scherm([2, 3, 0]));
    await klik(scherm([4, 3, 0]));
    gelijk(stand.model.nodes.filter((n) => n.id > 5).map((n) => [n.x, n.y]), [[2, 3], [4, 3]], "met de schakelaar uit: een knoop naast knoop 4");
    gelijk(regels(), ["Knoop 6 valt samen met knoop 4 (3 mm)."], "de modelcontrole meldt hem");
  });

  await test("tekenen op het voetpunt van staaf 1, 3 mm van haar begin (knoopsnap uit): de staaf begint op knoop 1, staaf 1 blijft heel met haar puntlast", async () => {
    zetSnap("knoop", false);
    zetSnap("raster", false);
    // Staaf 1 van knoop 1 (0; 0) naar 2 (6; 0) met een puntlast op positie 0;
    // knoop 3 ligt 3,7 m erboven, 3 mm rechts van knoop 1.
    const begin = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 0.003, y: 3.7, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }], ...leeg,
      memberPointLoads: [{ id: 1, beamId: 1, caseId: 1, py: 0, pz: -10, positionM: 0 }],
    });
    mount(<Werkruimte begin={begin} tool="addBeam" />);
    await wacht(400);
    const vlak = container.querySelector<HTMLElement>(".open-fem3d-canvas")!;
    // Staaf 1 verwerven (de muis stil erboven), dan beginnen op knoop 3.
    await klik(scherm([0.003, 3.7, 0]));
    await wijs(scherm([3, 0, 0]));
    await wacht(650);
    // 6 px onder het voetpunt (0,003; 0): de klik raakt de staaf niet, het voetpunt ligt op staaf 1.
    const voet = scherm([0.003, 0, 0]);
    const plek = { x: voet.x, y: voet.y + 6 };
    await wijs(plek);
    await klik(plek);
    gelijk(vlak.dataset.openFem3dStaafSplitsing, "1:voetpunt", "het voetpunt op staaf 1");
    gelijk(vlak.dataset.openFem3dSamengevoegd, "1", "het voetpunt ligt binnen 5 mm van knoop 1: dat wordt knoop 1");
    gelijk(ketting(stand.model), [[1, 1, 2], [2, 3, 1]], "staaf 1 heel, de nieuwe staaf van knoop 3 naar knoop 1");
    gelijk(stand.model.memberPointLoads, begin.memberPointLoads, "de puntlast op staaf 1 blijft");
    gelijk(stand.samengevoegd.filter((n) => n > 0), [], "de pijplijn hoefde niets samen te voegen");
  });

  await test("verplaatsen (paneel Verplaatsen) midden tussen twee knopen die 8 mm uit elkaar liggen: hij gaat op in knoop 1, knoop 2 en de kolom erop blijven", async () => {
    const m0 = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 2, y: 0, z: 0 }, { id: 2, x: 2.008, y: 0, z: 0 }, { id: 3, x: 2.008, y: 0, z: 3 }, { id: 4, x: 6, y: 2, z: 0 }],
      beams: [{ id: 1, startNodeId: 2, endNodeId: 3 }], ...leeg,
    });
    mount(<Werkruimte begin={m0} tool="move" beginSelectie={{ type: "node", id: 4 }} />);
    await wacht(300);
    const paneel = container.querySelector<HTMLElement>(".open-fem3d-transform-panel");
    ok(paneel, "het paneel Verplaatsen staat open");
    typ(paneel!.querySelectorAll<HTMLInputElement>("input")[0], "-3996"); // ΔX in mm
    typ(paneel!.querySelectorAll<HTMLInputElement>("input")[1], "-2000"); // ΔY in mm
    flushSync(() => paneel!.querySelector<HTMLButtonElement>("button.primary")!.click());
    await wacht();
    gelijk(knoopIds(stand.model), [1, 2, 3], "knoop 4 is opgegaan in knoop 1");
    gelijk(stand.model.nodes.find((n) => n.id === 2), m0.nodes[1], "knoop 2 staat waar hij stond");
    gelijk(ketting(stand.model), [[1, 2, 3]], "de kolom staat nog op knoop 2");
    gelijk(stand.selectie, { type: "node", id: 1 }, "de selectie is knoop 1");
  });

  await test("de modelcontrole bij twee knopen op verschillende levels: de levels bij naam en hoogte, niet hun id", async () => {
    const stramien: StructuralGrid = {
      enabled: true, xAxes: [], yAxes: [],
      zAxes: [{ id: "z-1759600000000", label: "Verdieping 1", position: 3000 }, { id: "z-1759600000123", label: "Tussenvloer", position: 3002 }],
    };
    mount(<Werkruimte stramien={stramien} begin={parseOpenFem3DModel({
      nodes: [{ id: 1, x: 2, y: 0, z: 3, levelId: "z-1759600000000" }, { id: 2, x: 2.002, y: 0, z: 3.002, levelId: "z-1759600000123" },
        { id: 3, x: 6, y: 0, z: 3 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 3 }], ...leeg,
    })} />);
    await wacht(400);
    gelijk(regels(), ["Knopen 1, 2: ze hangen aan verschillende levels: Verdieping 1 (3000 mm), Tussenvloer (3002 mm)."], "de regel met de reden");
    ok(samenvoegKnop()?.disabled, "de knop Samenvoegen staat uit");
  });

  await test("verplaatsen (paneel Verplaatsen) tot 2 mm naast knoop 1: knoop 2 wordt knoop 1, de selectie ook", async () => {
    const m0 = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 2, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 3, z: 0 }],
      beams: [{ id: 1, startNodeId: 2, endNodeId: 3 }], ...leeg,
    });
    mount(<Werkruimte begin={m0} tool="move" beginSelectie={{ type: "node", id: 2 }} />);
    await wacht(300);
    const paneel = container.querySelector<HTMLElement>(".open-fem3d-transform-panel");
    ok(paneel, "het paneel Verplaatsen staat open");
    typ(paneel!.querySelectorAll<HTMLInputElement>("input")[0], "-3998"); // ΔX in mm
    flushSync(() => paneel!.querySelector<HTMLButtonElement>("button.primary")!.click());
    await wacht();
    gelijk(knoopIds(stand.model), [1, 3], "knoop 2 is opgegaan in knoop 1");
    gelijk(ketting(stand.model), [[1, 1, 3]], "de staaf hangt aan knoop 1");
    gelijk(stand.selectie, { type: "node", id: 1 }, "de selectie is knoop 1");
    gelijk(stand.stappen, 1, "één stap");
  });
}

/* ── Beelden voor de schermafbeeldingen ───────────────────────────────── */

async function toonBeeld(beeld: string) {
  const zicht = { ...ZICHT, nodeNumbers: true, beamNumbers: true };
  if (beeld === "kaart") {
    // Een losse knoop op een staaf en de samenvallende platen: beide kopregels met hun knop.
    const m = tweePlaten();
    const metStaaf = parseOpenFem3DModel({
      ...m,
      nodes: [...m.nodes, { id: 11, x: 0, y: -1, z: 0 }, { id: 12, x: 8, y: -1, z: 0 }, { id: 13, x: 4, y: -1, z: 0 }],
      beams: [...m.beams, { id: 2, startNodeId: 11, endNodeId: 12, profileName: "HEA 200", material: "S235" }],
    });
    mount(<Werkruimte begin={metStaaf} camera={SCHUIN} zicht={zicht} />);
    await wacht(1500);
    return;
  }
  if (beeld === "lint") {
    // Het lint (3D), het tekenvlak en de samenvatting na een klik op Knopen
    // samenvoegen (het hele model). Breed genoeg voor de groep Bewerken; de
    // melding (in de app rechtsboven over het lint) hier onder het lint, zodat
    // de knop in beeld blijft.
    const stijl = document.createElement("style");
    stijl.textContent = ".toast-host { top: 150px !important; }";
    document.head.appendChild(stijl);
    mount(<div style={{ width: 1900 }}><Werkruimte begin={tweePlaten()} camera={SCHUIN} zicht={zicht} lint breedte={1900} toastDuur={600_000} /></div>);
    await wacht(1200);
    // Het 3D-lint is breder dan het venster: schuif het (alleen voor het beeld)
    // zo op dat de groep Bewerken met Knopen samenvoegen in het midden staat.
    const groep = lintKnop()!.closest<HTMLElement>(".ribbon-group")!;
    const paneel = groep.closest<HTMLElement>(".ribbon-content-panel")!;
    const links = groep.getBoundingClientRect().left - paneel.getBoundingClientRect().left;
    paneel.style.transform = `translateX(${Math.min(0, 760 - links)}px)`;
    flushSync(() => lintKnop()!.click());
    await wacht(600);
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, info, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, info, error: String(e?.stack ?? e) }); });
