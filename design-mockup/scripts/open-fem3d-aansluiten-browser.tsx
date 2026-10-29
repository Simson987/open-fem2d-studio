/**
 * Browserkant van test-open-fem3d-aansluiten-ui.mjs: knopen op staven
 * aansluiten (issue #63) in de echte 3D-werkruimte (OpenFem3DEditor met
 * ThreeFrameCanvas, WebGL), met echte klikken op het tekenvlak, het paneel
 * Verplaatsen, de tab Weergave en het lint. De werkruimte bewaart het model
 * in de echte historie (openFem3dHistoryReducer) en roept dezelfde stappen
 * aan als App.tsx, met de snapinstellingen zoals ze zijn:
 * `openFem3DEditWithAutoConnect` voor elke bewerking (App.setOpenFem3d, met
 * het verslag terug voor de selectie na een transformatie),
 * `openFem3DConnectButton` voor de knop Aansluiten ("model") en de lintknop
 * ("selectie", App.handleOpenFem3DConnectNodes).
 *
 * Bewaakt:
 *  - een staaf tekenen door een losse knoop: de nieuwe staaf is op die knoop
 *    gesplitst, één stap ongedaan maken; een losse knoop op een andere staaf
 *    (een oud project) blijft los en staat in de modelcontrole;
 *  - een knoop tekenen op een staaf (gereedschap Knoop, rastersnap): de staaf
 *    is op de nieuwe knoop gesplitst;
 *  - de modelcontrole: "Knoop 3 ligt op staaf 1 maar is niet verbonden." met
 *    de knop Aansluiten; die splitst in één stap, de kaart verdwijnt, en
 *    ongedaan maken brengt beide terug; inklappen en weer openklappen bij
 *    Berekenen (modelCheckToken); overlappende staven: de reden in de regel
 *    en de knop uit;
 *  - de kaart ligt onder de kopregel, ook als de uitleg over meer regels
 *    loopt (760 en 1100 px, vier talen, de langste uitleg), en niet over de
 *    view cube;
 *  - de schakelaar uit: de staaf blijft heel, de modelcontrole meldt het;
 *  - twee keer verplaatsen met het paneel: de eerste keer wordt de ligger op
 *    een kolomvoet gesplitst, de tweede keer gaat de hele ligger mee;
 *  - de tab Weergave in 3D: de schakelaar (standaard aan) en de
 *    verbindingstolerantie met de uitleg van 3D; het lint: de knop Knopen
 *    aansluiten met zijn uitleg, en met alleen een kolom geselecteerd sluit
 *    hij haar voet aan op de balk.
 *
 * `#beeld=modelcontrole` en `#beeld=instelling` tonen alleen een beeld, voor
 * een schermafbeelding. De uitslag komt als JSON in #uitslag.
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
import commonEn from "../src/i18n/locales/en/common.json";
import commonDe from "../src/i18n/locales/de/common.json";
import commonFr from "../src/i18n/locales/fr/common.json";
import ribbonEn from "../src/i18n/locales/en/ribbon.json";
import ribbonDe from "../src/i18n/locales/de/ribbon.json";
import ribbonFr from "../src/i18n/locales/fr/ribbon.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import "../src/App.css";
import "../src/components/ribbon/Ribbon.css";
import "../src/components/fem/FemProjectTree.css";
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import ExplorerViewTab from "../src/components/fem/ExplorerViewTab";
import HomeTab from "../src/components/ribbon/HomeTab";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { openFem3DConnectButton, openFem3DEditWithAutoConnect } from "../src/components/openFem3d/openFem3dAansluiten";
import { openFem3dHistoryReducer, type OpenFem3DEditMeta, type OpenFem3DHistory } from "../src/components/openFem3d/openFem3dHistory";
import { herstelSnapBeginstand, leesSnapInstellingen, zetKnopenAansluiten, zetSnap } from "../src/hooks/useSnapInstellingen";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DTool } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";


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
// Headless met virtuele tijd tekent geen beeldjes: animatieframes via een timer.
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);

// De camera waarmee het tekenvlak echt tekent (zoals in open-fem3d-plaatsen-browser.tsx).
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

type Punt = [number, number, number];
/**
 * Staaf 1 van (0; 0) naar (8; 0) met een losse knoop 3 erop op 4 m (zo komt
 * een oud project binnen), en drie losse knopen op y = 3 m: 4 (2; 3), 6 (4; 3)
 * en 5 (6; 3). Een staaf van 4 naar 5 loopt door knoop 6.
 */
function model(): OpenFem3DModel {
  return parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 0 },
      { id: 4, x: 2, y: 3, z: 0 }, { id: 5, x: 6, y: 3, z: 0 }, { id: 6, x: 4, y: 3, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 200", material: "S235" }],
    supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
  });
}
const K4: Punt = [2, 3, 0], K5: Punt = [6, 3, 0];
const ZICHT: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY,
  grid: false, axes: false, structuralGrid: false, levelMarks: false, nodeNumbers: false, viewCube: false,
  deformation: false, reactions: false, utilization: false,
};
/** Recht van boven op het werkvlak (z = 0), schuin genoeg voor perspectief. */
const BOVEN: OpenFem3DCameraState = { position: [4, 1.5, 16], target: [4, 1.5, 0], up: [0, 1, 0] };

interface Stand {
  model: OpenFem3DModel; stappen: number; history: OpenFem3DHistory;
  /** Per wijziging: hoeveel staven het automatisch aansluiten splitste. */
  automatisch: number[];
}
let stand: Stand & { selectie: OpenFem3DSelection };
let doe: { undo: () => void; token: () => void; gereedschap: (tool: OpenFem3DTool) => void };

function Werkruimte({ begin, camera = BOVEN, zicht = ZICHT, tool = "select", beginSelectie = null, breedte = 900, lint = false }: {
  begin: OpenFem3DModel; camera?: OpenFem3DCameraState; zicht?: OpenFem3DVisibility; tool?: OpenFem3DTool;
  beginSelectie?: OpenFem3DSelection; breedte?: number; lint?: boolean;
}) {
  const [history, setHistory] = React.useState<OpenFem3DHistory>({ model: begin, past: [], future: [] });
  const [gereedschap, setGereedschap] = React.useState<OpenFem3DTool>(tool);
  const [selectie, setSelectieState] = React.useState<OpenFem3DSelection>(beginSelectie);
  const [token, setToken] = React.useState(0);
  const historyRef = React.useRef(history);
  historyRef.current = history;
  const selectieRef = React.useRef(selectie);
  const setSelectie = (next: OpenFem3DSelection) => { selectieRef.current = next; setSelectieState(next); };
  const automatisch = React.useRef<number[]>([]);
  const zet = (next: OpenFem3DHistory) => { historyRef.current = next; setHistory(next); };
  // Zoals App.setOpenFem3d: de stap van de app met de snapinstellingen, in
  // dezelfde stap ongedaan maken, met het verslag terug.
  const wijzig = (next: OpenFem3DModel, meta?: OpenFem3DEditMeta) => {
    const stap = openFem3DEditWithAutoConnect(historyRef.current.model, next, leesSnapInstellingen(), meta?.historyGroup);
    automatisch.current.push(stap.result?.splits.length ?? 0);
    zet(openFem3dHistoryReducer(historyRef.current, { type: "edit", model: stap.model, ...meta }));
    // De hele stap terug, zoals App.setOpenFem3d sinds #75 (samenvoegen en aansluiten).
    return stap;
  };
  // Zoals App.handleOpenFem3DConnectNodes("model") (de knop in de modelcontrole).
  const sluitAan = () => {
    const stap = openFem3DConnectButton(historyRef.current.model, selectieRef.current, leesSnapInstellingen(), "model");
    if (stap.model !== historyRef.current.model) zet(openFem3dHistoryReducer(historyRef.current, { type: "edit", model: stap.model }));
  };
  // Zoals App.handleOpenFem3DConnectNodes("selectie") (de lintknop).
  const lintKnop = () => {
    const stap = openFem3DConnectButton(historyRef.current.model, selectieRef.current, leesSnapInstellingen(), "selectie");
    if (stap.model !== historyRef.current.model) zet(openFem3dHistoryReducer(historyRef.current, { type: "edit", model: stap.model }));
  };
  stand = { model: history.model, stappen: history.past.length, history, automatisch: automatisch.current, selectie };
  doe = {
    undo: () => zet(openFem3dHistoryReducer(historyRef.current, { type: "undo" })),
    token: () => setToken((n) => n + 1),
    gereedschap: setGereedschap,
  };
  const editor = (
    <div style={{ display: "flex", width: breedte, height: 600, position: "relative" }}>
      <OpenFem3DEditor model={history.model} onChange={wijzig} visibility={zicht}
        tool={gereedschap} onToolChange={setGereedschap} selection={selectie} onSelectionChange={setSelectie}
        onConnectNodes={sluitAan} modelCheckToken={token}
        showLoadCase activeLoadCaseId={1} initialCamera={camera} gridSpacingM={0.5} />
    </div>
  );
  return lint ? (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="ribbon-container"><HomeTab modelDimension="3d" onOpenFem3DConnectNodes={lintKnop} /></div>
      {editor}
    </div>
  ) : editor;
}

const canvas3d = () => container.querySelector<HTMLCanvasElement>(".open-fem3d-canvas canvas")!;
const kaart = () => container.querySelector<HTMLElement>(".open-fem3d-model-check");
const regels = () => [...container.querySelectorAll<HTMLElement>(".open-fem3d-model-check-lijst li")].map((li) => li.textContent ?? "");
const aansluitKnop = () => container.querySelector<HTMLButtonElement>("[data-open-fem3d-connect-nodes]");
const ketting = (m: OpenFem3DModel) => m.beams.map((b) => [b.id, b.startNodeId, b.endNodeId]);

/** Schermpunt (client) van een wereldpunt, met de camera waarmee het tekenvlak tekent. */
function scherm(p: Punt): { x: number; y: number } {
  ok(renderCamera, "er is getekend");
  renderCamera!.updateMatrixWorld();
  const rect = canvas3d().getBoundingClientRect();
  const n = new THREE.Vector3(...p).project(renderCamera!);
  return { x: rect.left + (n.x + 1) / 2 * rect.width, y: rect.top + (1 - n.y) / 2 * rect.height };
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
async function begin(m: OpenFem3DModel, tool: OpenFem3DTool = "select", zicht = ZICHT) {
  mount(<Werkruimte begin={m} tool={tool} zicht={zicht} />);
  await wacht(400);
}
/** Een waarde in een React-invoerveld zetten zoals typen dat doet. */
function typ(el: HTMLInputElement | undefined, waarde: string) {
  ok(el, "invoerveld ontbreekt");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el!.dispatchEvent(new Event("input", { bubbles: true })));
}
/** Overlappen twee rechthoeken (meer dan een halve pixel)? */
const overlapt = (a: DOMRect, b: DOMRect) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
const leeg = { supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [] };

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  document.documentElement.setAttribute("data-oa-theme", "light");
  try { localStorage.clear(); } catch { /* privé venster */ }
  herstelSnapBeginstand();
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("een staaf tekenen door de losse knoop 6: de nieuwe staaf is op knoop 6 gesplitst, één stap ongedaan maken", async () => {
    // Het objectspoor uit: alleen de knoopsnap telt, zodat de klikken precies op knoop 4 en 5 landen.
    zetSnap("spoor", false);
    await begin(model(), "addBeam");
    await klik(scherm(K4));
    await klik(scherm(K5));
    gelijk(ketting(stand.model), [[1, 1, 2], [2, 4, 6], [3, 6, 5]], "staven na het tekenen");
    gelijk(stand.stappen, 1, "één stap ongedaan maken voor staaf en aansluiten samen");
    ok(stand.automatisch.includes(1), `het automatisch aansluiten splitste de getekende staaf (${JSON.stringify(stand.automatisch)})`);
    gelijk(regels(), ["Knoop 3 ligt op staaf 1 maar is niet verbonden."],
      "de losse knoop 3 op staaf 1 (het oude project) blijft los en staat in de modelcontrole");
    flushSync(() => doe.undo());
    await wacht();
    gelijk([ketting(stand.model), stand.stappen], [[[1, 1, 2]], 0], "ongedaan maken: de staaf en de splitsing samen weg");
  });

  await test("een knoop tekenen op staaf 1 (gereedschap Knoop, rastersnap op 6 m): staaf 1 is op de nieuwe knoop gesplitst", async () => {
    zetSnap("spoor", false);
    await begin(model(), "addNode");
    await klik(scherm([6, 0.04, 0]));
    const nieuw = stand.model.nodes.find((n) => n.id === 7);
    ok(nieuw && nieuw.x === 6 && nieuw.y === 0 && nieuw.z === 0, `nieuwe knoop 7 op (6; 0; 0): ${JSON.stringify(stand.model.nodes)}`);
    gelijk(ketting(stand.model), [[1, 1, 7], [2, 7, 2]], "staaf 1 gesplitst op knoop 7");
    // Het tekenvlak legde alleen de knoop neer; het splitsen deed het aansluiten.
    gelijk(stand.automatisch, [1], "het automatisch aansluiten splitste staaf 1");
    gelijk(stand.stappen, 1, "één stap");
    gelijk(regels(), ["Knoop 3 ligt op staaf 1 maar is niet verbonden."], "knoop 3 blijft gemeld (die raakte de bewerking niet)");
  });

  await test("de modelcontrole: de waarschuwing per knoop met de knop Aansluiten; één stap, de kaart verdwijnt, ongedaan maken brengt hem terug", async () => {
    await begin(model());
    ok(kaart(), "de modelcontrole staat in beeld bij het openen");
    gelijk(kaart()!.querySelector(".open-fem3d-model-check-toggle")?.textContent?.replace(/[▾▸!]/g, "").trim(),
      "1 knoop ligt op een staaf zonder verbinding", "kop");
    gelijk(regels(), ["Knoop 3 ligt op staaf 1 maar is niet verbonden."], "de regel per knoop");
    ok((aansluitKnop()?.title ?? "").includes("binnen 5 mm"), `uitleg bij de knop met de tolerantie: ${aansluitKnop()?.title}`);
    gelijk(aansluitKnop()?.textContent, "Aansluiten", "de knop");
    gelijk(stand.stappen, 0, "openen verandert het model niet");
    flushSync(() => aansluitKnop()!.click());
    await wacht();
    gelijk(ketting(stand.model), [[1, 1, 3], [2, 3, 2]], "staaf 1 gesplitst op knoop 3");
    gelijk(stand.stappen, 1, "één stap ongedaan maken");
    ok(!kaart(), "de kaart is weg");
    flushSync(() => doe.undo());
    await wacht();
    ok(kaart() && regels().length === 1, "na ongedaan maken staat de waarschuwing er weer");
  });

  await test("inklappen, en Berekenen (een nieuwe modelCheckToken) klapt de lijst weer open", async () => {
    await begin(model());
    flushSync(() => kaart()!.querySelector<HTMLButtonElement>(".open-fem3d-model-check-toggle")!.click());
    await wacht();
    gelijk(regels().length, 0, "ingeklapt: geen regels");
    ok(aansluitKnop(), "de knop Aansluiten blijft ook ingeklapt in beeld");
    flushSync(() => doe.token());
    await wacht();
    gelijk(regels().length, 1, "na Berekenen weer open");
  });

  await test("de schakelaar uit: een staaf door de losse knoop 6 blijft heel; de modelcontrole meldt hem", async () => {
    zetSnap("spoor", false);
    zetKnopenAansluiten(false);
    await begin(model(), "addBeam");
    await klik(scherm(K4));
    await klik(scherm(K5));
    gelijk(ketting(stand.model), [[1, 1, 2], [2, 4, 5]], "de getekende staaf is heel");
    gelijk(regels(), ["Knoop 3 ligt op staaf 1 maar is niet verbonden.", "Knoop 6 ligt op staaf 2 maar is niet verbonden."], "de modelcontrole");
  });

  await test("overlappende staven: de regel noemt de reden en de knop Aansluiten staat uit (hij zou niets doen)", async () => {
    // Staaf 1 (0 → 8 m) en staaf 2 (knoop 3 op 4 m → 8 m) liggen over elkaar.
    await begin(parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 2 }], ...leeg,
    }));
    gelijk(regels(), ["Knoop 3 ligt op staaf 1, maar staaf 1 en staaf 2 overlappen: aansluiten zou staaf 2 verdubbelen. Verwijder of verkort een van beide."],
      "de regel met de reden");
    ok(aansluitKnop()?.disabled, "de knop Aansluiten staat uit");
    ok((aansluitKnop()?.title ?? "").startsWith("Niets aan te sluiten"), `uitleg: ${aansluitKnop()?.title}`);
  });

  await test("de modelcontrole ligt onder de kopregel en naast de view cube: 760 en 1100 px, vier talen, de langste uitleg (oplegging, puntlast)", async () => {
    const fouten: string[] = [];
    let hoogsteKop = 0;
    try {
      for (const [taal, bundel] of [["nl", null], ["en", ribbonEn], ["de", ribbonDe], ["fr", ribbonFr]] as const) {
        if (bundel) i18next.addResourceBundle(taal, "ribbon", bundel, true, true);
        await i18next.changeLanguage(taal);
        for (const breedte of [760, 1100]) {
          for (const tool of ["support:pinned", "addPointLoad", "select"] as OpenFem3DTool[]) {
            mount(<Werkruimte begin={model()} tool={tool} breedte={breedte} zicht={{ ...ZICHT, viewCube: true }} />);
            await wacht(120);
            const kop = container.querySelector<HTMLElement>(".open-fem3d-stage-header")!.getBoundingClientRect();
            const vak = kaart()?.getBoundingClientRect();
            const kubus = container.querySelector<HTMLElement>(".open-fem3d-view-cube:not([hidden])")?.getBoundingClientRect();
            hoogsteKop = Math.max(hoogsteKop, kop.height);
            const geval = `${taal} ${breedte} px ${tool}`;
            if (!vak) { fouten.push(`${geval}: geen modelcontrole`); continue; }
            if (vak.top < kop.bottom - 0.5) fouten.push(`${geval}: kaart (boven ${vak.top.toFixed(0)}) over de kopregel (onder ${kop.bottom.toFixed(0)})`);
            if (kubus && overlapt(vak, kubus)) fouten.push(`${geval}: kaart over de view cube`);
            if (!kubus) fouten.push(`${geval}: geen view cube in beeld`);
          }
        }
      }
    } finally {
      await i18next.changeLanguage("nl");
    }
    info.push(`hoogste kopregel ${hoogsteKop.toFixed(0)} px (de oude vaste kaart op 60 px lag vanaf 46 px over de uitleg)`);
    gelijk(fouten, [], "overlap");
    ok(hoogsteKop > 46, `de proef raakt een kopregel over meer regels (${hoogsteKop.toFixed(0)} px)`);
  });

  await test("twee keer verplaatsen (paneel Verplaatsen): eerst wordt de ligger op de kolomvoet gesplitst, de selectie wijst beide delen aan, daarna gaat de hele ligger mee", async () => {
    // Ligger 1 (0 → 8 m) op y = 0; een kolom 3 met haar voet 5 op (4; 1; 0).
    const m0 = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 5, x: 4, y: 1, z: 0 }, { id: 6, x: 4, y: 1, z: 3 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 3, startNodeId: 5, endNodeId: 6 }], ...leeg,
    });
    mount(<Werkruimte begin={m0} tool="move" beginSelectie={{ type: "beam", id: 1 }} />);
    await wacht(300);
    const verplaats = async () => {
      const paneel = container.querySelector<HTMLElement>(".open-fem3d-transform-panel");
      ok(paneel, "het paneel Verplaatsen staat open");
      typ(paneel!.querySelectorAll<HTMLInputElement>("input")[1], "1000"); // ΔY in mm
      flushSync(() => paneel!.querySelector<HTMLButtonElement>("button.primary")!.click());
      await wacht();
    };
    await verplaats();
    gelijk(ketting(stand.model), [[1, 1, 5], [4, 5, 2], [3, 5, 6]], "de ligger is op de kolomvoet 5 gesplitst");
    gelijk(stand.selectie, { type: "multi", nodeIds: [], beamIds: [1, 4] }, "de selectie wijst beide delen aan");
    flushSync(() => doe.gereedschap("move"));
    await wacht();
    await verplaats();
    const y = (id: number) => stand.model.nodes.find((n) => n.id === id)?.y;
    gelijk([y(1), y(5), y(2)], [2, 2, 2], "de hele ligger staat op y = 2 (geen knik halverwege)");
    gelijk(stand.stappen, 2, "twee stappen ongedaan maken");
  });

  await test("tab Weergave in 3D: de schakelaar Knopen automatisch samenvoegen en aansluiten (standaard aan, label heel op hoogstens twee regels bij 240 px in vier talen) en de verbindingstolerantie met de uitleg van 3D", async () => {
    // In een vak van 240 px: de standaardbreedte van het linkerpaneel (App.tsx, leftPanelWidth).
    const tab = () => mount(<div style={{ width: 240 }}><ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} workspace="3d"
      gridShow={false} setGridShow={() => {}} stramienAan setStramienAan={() => {}}
      openFem3dVisibility={DEFAULT_OPEN_FEM_3D_VISIBILITY} setOpenFem3DVisibility={() => {}} /></div>);
    const zoek = () => [...container.querySelectorAll<HTMLButtonElement>("button[role=switch]")]
      .find((b) => b.textContent === i18next.t("zichtbaarheid.knopenAansluiten"));
    // Het label staat voluit, in alle vier talen: niet afgekapt met "…", hoogstens twee regels.
    const afgekapt: string[] = [];
    try {
      for (const [taal, bundel] of [["en", commonEn], ["de", commonDe], ["fr", commonFr], ["nl", null]] as const) {
        if (bundel) i18next.addResourceBundle(taal, "common", bundel, true, true);
        await i18next.changeLanguage(taal);
        tab();
        await wacht(40);
        const label = zoek()?.querySelector<HTMLElement>(".fem-results-toggle-label");
        ok(label, `${taal}: de schakelaar staat in de tab`);
        const regels = Math.round(label!.getBoundingClientRect().height / parseFloat(getComputedStyle(label!).lineHeight));
        info.push(`${taal}: "${label!.textContent}" ${label!.scrollWidth}/${label!.clientWidth} px, ${regels} regel(s)`);
        if (label!.scrollWidth > label!.clientWidth + 1 || regels > 2) {
          afgekapt.push(`${taal} (${label!.scrollWidth} > ${label!.clientWidth} of ${regels} regels): ${label!.textContent}`);
        }
      }
    } finally {
      await i18next.changeLanguage("nl");
    }
    gelijk(afgekapt, [], "label heel en hoogstens twee regels bij 240 px");
    tab();
    await wacht(40);
    const schakelaar = zoek();
    gelijk(schakelaar?.textContent, "Knopen automatisch samenvoegen en aansluiten", "nl-label");
    ok(schakelaar, "de schakelaar staat in de tab");
    gelijk(schakelaar!.getAttribute("aria-checked"), "true", "standaard aan");
    ok((schakelaar!.title ?? "").startsWith("Alleen in 3D."), `uitleg: ${schakelaar!.title}`);
    ok(schakelaar!.closest(".explorer-view-section")?.querySelector(".fem-results-section-title")?.textContent === "Snap",
      "bij de snapinstellingen");
    flushSync(() => schakelaar!.click());
    gelijk(leesSnapInstellingen().knopenAansluiten, false, "een klik zet hem uit (bewaard met de snaps)");
    const rij = container.querySelector<HTMLElement>('[data-snap-opties="verbinding"]');
    ok(rij && (rij.title ?? "").includes("De knoop wordt niet verplaatst"), `de verbindingstolerantie met de uitleg van 3D: ${rij?.title}`);
    const alleSnaps = [...container.querySelectorAll<HTMLButtonElement>("button[role=switch]")]
      .find((b) => b.textContent?.includes(i18next.t("zichtbaarheid.snapAll")));
    flushSync(() => alleSnaps!.click());
    gelijk(leesSnapInstellingen().knopenAansluiten, false, "'Alle snapsoorten' laat de schakelaar staan");
  });

  await test("het 3D-lint: de knop Knopen aansluiten, met zijn uitleg", async () => {
    let geroepen = 0;
    mount(<div className="ribbon-container"><HomeTab modelDimension="3d" onOpenFem3DConnectNodes={() => { geroepen += 1; }} /></div>);
    await wacht();
    const knop = [...container.querySelectorAll<HTMLButtonElement>("button.ribbon-btn")]
      .find((b) => b.querySelector(".ribbon-btn-label")?.textContent === "Knopen aansluiten");
    ok(knop && !knop.disabled, "de knop staat in het lint");
    ok(lintUitleg(knop).startsWith("Knopen op staven aansluiten:"), `uitleg: ${lintUitleg(knop)}`);
    ok(lintUitleg(knop).includes("begin- en eindknoop"), `uitleg noemt de eindknopen van een geselecteerde staaf: ${lintUitleg(knop)}`);
    flushSync(() => knop!.click());
    gelijk(geroepen, 1, "een klik roept de handler");
  });

  await test("het lint met alleen een kolom geselecteerd: haar voet wordt op de balk aangesloten (één stap); een andere losse knoop niet", async () => {
    // Balk 1 (0 → 8 m), kolom 2 met voet 3 op 4 m en kop 4; een losse knoop 5 op 6 m.
    const balk = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 0 }, { id: 4, x: 4, y: 0, z: 3 },
        { id: 5, x: 6, y: 0, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }], ...leeg,
    });
    mount(<Werkruimte begin={balk} beginSelectie={{ type: "beam", id: 2 }} lint />);
    await wacht(300);
    const knop = [...container.querySelectorAll<HTMLButtonElement>("button.ribbon-btn")]
      .find((b) => b.querySelector(".ribbon-btn-label")?.textContent === "Knopen aansluiten");
    ok(knop, "de knop staat in het lint");
    flushSync(() => knop!.click());
    await wacht();
    gelijk(ketting(stand.model), [[1, 1, 3], [3, 3, 2], [2, 3, 4]], "balk 1 gesplitst op de kolomvoet 3");
    gelijk(stand.stappen, 1, "één stap");
    gelijk(regels(), ["Knoop 5 ligt op staaf 3 maar is niet verbonden."], "knoop 5 (niet geselecteerd) blijft los en gemeld");
  });
}

/* ── Beelden voor de schermafbeeldingen ───────────────────────────────── */

/**
 * Een funderingsbalk van 12 m (1 → 2) met drie kolommen erop waarvan de voeten
 * (3, 4, 5) los op de balk liggen: zo kwam het model uit het issue binnen.
 */
function funderingsbalk(): OpenFem3DModel {
  return parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 12, y: 0, z: 0 },
      { id: 3, x: 3, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 0 }, { id: 5, x: 9, y: 0, z: 0 },
      { id: 6, x: 3, y: 0, z: 3 }, { id: 7, x: 6, y: 0, z: 3 }, { id: 8, x: 9, y: 0, z: 3 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 300", material: "S235" },
      { id: 2, startNodeId: 3, endNodeId: 6, profileName: "HEA 200", material: "S235" },
      { id: 3, startNodeId: 4, endNodeId: 7, profileName: "HEA 200", material: "S235" },
      { id: 4, startNodeId: 5, endNodeId: 8, profileName: "HEA 200", material: "S235" }],
    supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
  });
}
const SCHUIN: OpenFem3DCameraState = { position: [2, -13, 7], target: [6, 0, 1.4], up: [0, 0, 1] };

async function toonBeeld(beeld: string) {
  const zicht = { ...ZICHT, nodeNumbers: true, beamNumbers: true };
  if (beeld === "modelcontrole") {
    mount(<Werkruimte begin={funderingsbalk()} camera={SCHUIN} zicht={zicht} />);
    await wacht(1500);
    return;
  }
  if (beeld === "instelling") {
    // Het lint (3D), de tab Weergave met de schakelaar en de verbindingstolerantie, en het tekenvlak met de modelcontrole.
    mount(<div style={{ display: "flex", flexDirection: "column", width: 1150, height: 660, background: "var(--theme-bg)" }}>
      {/* Zoals Ribbon.tsx het lint zet: container, wrapper en paneel. */}
      <div className="ribbon-container" style={{ flex: "none", marginTop: 0 }}>
        <div className="ribbon-content-wrapper"><div className="ribbon-content-panel">
          <HomeTab modelDimension="3d" onOpenFem3DConnectNodes={() => {}} />
        </div></div>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div className="beeld-paneel" style={{ width: 260, overflow: "auto", borderRight: "1px solid var(--theme-border)" }}>
          <ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} workspace="3d"
            gridShow={false} setGridShow={() => {}} stramienAan setStramienAan={() => {}}
            openFem3dVisibility={DEFAULT_OPEN_FEM_3D_VISIBILITY} setOpenFem3DVisibility={() => {}} />
        </div>
        <div style={{ flex: 1, position: "relative", display: "flex" }}>
          <Werkruimte begin={funderingsbalk()} camera={SCHUIN} zicht={zicht} />
        </div>
      </div>
    </div>);
    await wacht(1500);
    // De snaprijen in beeld: alleen het paneel scrollt (onderaan de tab), het lint blijft staan.
    const paneel = container.querySelector<HTMLElement>(".beeld-paneel");
    if (paneel) paneel.scrollTop = paneel.scrollHeight;
    await wacht(200);
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, info, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, info, error: String(e?.stack ?? e) }); });
