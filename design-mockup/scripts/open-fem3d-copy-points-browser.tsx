/**
 * Browserkant van test-open-fem3d-copy-points-ui.mjs: kopiëren met basispunt
 * en doelpunt in de echte 3D-werkruimte (OpenFem3DEditor met ThreeFrameCanvas,
 * WebGL), met echte klikken op het tekenvlak. De werkruimte bewaart het model
 * in de echte historie (openFem3dHistoryReducer) en laat elke bewerking door
 * `openFem3DEditWithAutoConnect` gaan, zoals App.setOpenFem3d.
 *
 * Bewaakt:
 *  - met een selectie en het gereedschap Kopiëren: de uitleg "Klik het
 *    bronpunt van de kopie." in de kopregel en in het paneel Kopiëren;
 *  - de eerste klik (op een knoop) is alleen een punt: het model en de
 *    selectie blijven, de uitleg wordt "Klik het doelpunt …", en bij het
 *    bewegen loopt een rubberband met maatlabel vanaf het bronpunt;
 *  - de tweede klik (op een andere knoop) kopieert de selectie over doelpunt −
 *    bronpunt, in één stap; de gekopieerde staaf sluit op de doelknoop aan
 *    (automatisch samenvoegen), de kopie is geselecteerd en het gereedschap
 *    staat weer op Selecteren;
 *  - een staaf met een plaat (groepsselectie) naar een rasterpunt in het
 *    werkvlak: de verschuiving ligt op het raster;
 *  - twee keer hetzelfde punt: geen kopie, het bronpunt blijft staan;
 *  - Esc na het bronpunt: terug naar Selecteren, niets gekopieerd;
 *  - zonder selectie: de uitleg "Selecteer eerst …", de eerste klik kiest de
 *    staaf, en daarna zijn bron- en doelpunt gewoon te kiezen;
 *  - met een selectie vult Shift- of Ctrl-klik de selectie aan (of haalt er
 *    iets uit) in plaats van een punt te zetten; een gekozen bronpunt vervalt
 *    dan;
 *  - in de explodeweergave: geen puntuitleg in kopregel en paneel maar de
 *    melding dat Exploderen uit moet, en een klik kiest (geen bronpunt);
 *  - het lint Start: de knoppen houden hun naam voor schermlezers
 *    (aria-label); met ruimte genoeg volledige namen (2D in 1920 px, en de
 *    tabs Tabel en IFC houden hun eigen opmaak); past het met volledige namen
 *    net niet, dan eerst ingekorte namen; past het ook zo niet (3D in
 *    1600 px), dan alleen pictogrammen bij de kleine knoppen
 *    (useRibbonCompact); bij een breder vak komen de namen terug; past het
 *    ook compact niet, dan schuift het horizontaal.
 *
 * `#beeld=kopie` en `#beeld=lint` (met `&dim=2d` het 2D-lint) tonen alleen een
 * beeld, voor een schermafbeelding. De uitslag komt als JSON in #uitslag.
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
import "../src/components/fem/FemProjectTree.css";
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import HomeTab from "../src/components/ribbon/HomeTab";
import TableTab from "../src/components/ribbon/TableTab";
import IfcTab from "../src/components/ribbon/IfcTab";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { openFem3DEditWithAutoConnect } from "../src/components/openFem3d/openFem3dAansluiten";
import { openFem3dHistoryReducer, type OpenFem3DEditMeta, type OpenFem3DHistory } from "../src/components/openFem3d/openFem3dHistory";
import { herstelSnapBeginstand, leesSnapInstellingen } from "../src/hooks/useSnapInstellingen";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DTool } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};
// Headless met virtuele tijd tekent geen beeldjes: animatieframes via een timer.
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);

// De camera waarmee het tekenvlak echt tekent (zoals in open-fem3d-samenvoegen-browser.tsx).
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
 * Staaf 1 van knoop 1 (0; 0; 0) naar knoop 2 (4; 0; 0) met een oplegging op
 * knoop 1, een losse knoop 3 op (2; 3; 0), en plaat 1 (knopen 4–7) van
 * (0; -3) tot (4; -1).
 */
function begin(): OpenFem3DModel {
  return parseOpenFem3DModel({
    ...leeg,
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }, { id: 3, x: 2, y: 3, z: 0 },
      { id: 4, x: 0, y: -3, z: 0 }, { id: 5, x: 4, y: -3, z: 0 }, { id: 6, x: 4, y: -1, z: 0 }, { id: 7, x: 0, y: -1, z: 0 },
    ],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S235" }],
    plates: [{ id: 1, nodeIds: [4, 5, 6, 7], thicknessM: 0.2 }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }],
  });
}
const ZICHT: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY,
  grid: false, axes: false, structuralGrid: false, levelMarks: false, nodeNumbers: false, viewCube: false,
  deformation: false, reactions: false, utilization: false,
};
/** Recht van boven op het werkvlak (z = 0). */
const BOVEN: OpenFem3DCameraState = { position: [2, 0.5, 18], target: [2, 0.5, 0], up: [0, 1, 0] };

interface Stand { model: OpenFem3DModel; stappen: number; selectie: OpenFem3DSelection; gereedschap: OpenFem3DTool }
let stand: Stand;

function Werkruimte({ tool = "copy", beginSelectie = null, zicht = ZICHT, breedte = 900 }: {
  tool?: OpenFem3DTool; beginSelectie?: OpenFem3DSelection; zicht?: OpenFem3DVisibility; breedte?: number;
}) {
  const [history, setHistory] = React.useState<OpenFem3DHistory>({ model: begin(), past: [], future: [] });
  const [gereedschap, setGereedschap] = React.useState<OpenFem3DTool>(tool);
  const [selectie, setSelectie] = React.useState<OpenFem3DSelection>(beginSelectie);
  const historyRef = React.useRef(history);
  historyRef.current = history;
  // Zoals App.setOpenFem3d: samenvoegen en aansluiten in dezelfde stap, met de stap terug.
  const wijzig = (next: OpenFem3DModel, meta?: OpenFem3DEditMeta) => {
    const stap = openFem3DEditWithAutoConnect(historyRef.current.model, next, leesSnapInstellingen(), meta?.historyGroup);
    const volgende = openFem3dHistoryReducer(historyRef.current, { type: "edit", model: stap.model, ...meta });
    historyRef.current = volgende;
    setHistory(volgende);
    return stap;
  };
  stand = { model: history.model, stappen: history.past.length, selectie, gereedschap };
  return (
    <div style={{ display: "flex", width: breedte, height: 560, position: "relative" }}>
      <OpenFem3DEditor model={history.model} onChange={wijzig} visibility={zicht}
        tool={gereedschap} onToolChange={setGereedschap} selection={selectie} onSelectionChange={setSelectie}
        showLoadCase activeLoadCaseId={1} initialCamera={BOVEN} gridSpacingM={0.5} />
    </div>
  );
}

const canvas3d = () => container.querySelector<HTMLCanvasElement>(".open-fem3d-canvas canvas")!;
const tekenvlak = () => container.querySelector<HTMLElement>(".open-fem3d-canvas")!;
const kopUitleg = () => container.querySelector<HTMLElement>(".open-fem3d-stage-header > span")?.textContent ?? "";
const paneel = () => container.querySelector<HTMLElement>(".open-fem3d-transform-panel");
const paneelUitleg = () => paneel()?.querySelector<HTMLElement>("[role=status]")?.textContent ?? "";
const ketting = (m: OpenFem3DModel) => m.beams.map((b) => [b.id, b.startNodeId, b.endNodeId]);
const knoop = (m: OpenFem3DModel, id: number) => {
  const n = m.nodes.find((k) => k.id === id);
  return n ? [n.x, n.y, n.z].map((v) => Math.round(v * 1e6) / 1e6) : null;
};

type Punt = [number, number, number];
/** Schermpunt (client) van een wereldpunt, met de camera waarmee het tekenvlak tekent. */
function scherm(p: Punt): { x: number; y: number } {
  ok(renderCamera, "er is getekend");
  renderCamera!.updateMatrixWorld();
  const rect = canvas3d().getBoundingClientRect();
  const n = new THREE.Vector3(...p).project(renderCamera!);
  return { x: rect.left + (n.x + 1) / 2 * rect.width, y: rect.top + (1 - n.y) / 2 * rect.height };
}
const basis = (punt: { x: number; y: number }) =>
  ({ bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: punt.x, clientY: punt.y });
/** De aanwijzer naar dit punt bewegen, zonder klik. */
async function wijs(punt: { x: number; y: number }) {
  flushSync(() => canvas3d().dispatchEvent(new PointerEvent("pointermove", { ...basis(punt), button: -1, buttons: 0 })));
  await wacht(80);
}
/** Een echte klik (aanwijzer bewegen, neer en op dezelfde plek) op het WebGL-canvas, eventueel met Shift of Ctrl. */
async function klik(punt: { x: number; y: number }, toetsen: { shiftKey?: boolean; ctrlKey?: boolean } = {}) {
  const canvas = canvas3d();
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointermove", { ...basis(punt), ...toetsen, button: -1, buttons: 0 })));
  await wacht(60);
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointerdown", { ...basis(punt), ...toetsen, button: 0, buttons: 1 })));
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointerup", { ...basis(punt), ...toetsen, button: 0, buttons: 0 })));
  await wacht(120);
}

const BRON = "Klik het bronpunt van de kopie.";
const DOEL = "Klik het doelpunt om de selectie te kopiëren.";

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

  await test("staaf 1 van knoop 1 naar knoop 3: de uitleg per stap, een rubberband na het bronpunt, één stap, de kopie sluit aan op knoop 3 en is geselecteerd", async () => {
    mount(<Werkruimte beginSelectie={{ type: "beam", id: 1 }} />);
    await wacht(400);
    gelijk(kopUitleg(), BRON, "de kopregel vraagt het bronpunt");
    ok(paneel(), "het paneel Kopiëren staat open");
    gelijk(paneelUitleg(), BRON, "het paneel noemt het bronpunt");
    await klik(scherm([0, 0, 0]));
    gelijk(stand.stappen, 0, "het bronpunt verandert het model niet");
    gelijk(stand.selectie, { type: "beam", id: 1 }, "de selectie blijft staaf 1");
    gelijk(stand.gereedschap, "copy", "het gereedschap blijft Kopiëren");
    gelijk(kopUitleg(), DOEL, "de kopregel vraagt het doelpunt");
    gelijk(paneelUitleg(), DOEL, "het paneel noemt het doelpunt");
    // Naast een knoop (geen knoopsnap) ligt het punt op het werkvlak door het bronpunt.
    await wijs(scherm([1, 2, 0]));
    await wacht(100);
    gelijk(tekenvlak().dataset.openFem3dDrawingPlaneSource, "anchor", "het werkvlak gaat door het bronpunt");
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "raster", "het vrije punt valt op het raster");
    await wijs(scherm([2, 3, 0]));
    await wacht(100);
    gelijk(tekenvlak().dataset.openFem3dTekenpunt, "knoop", "op knoop 3 vangt de knoopsnap");
    ok((tekenvlak().dataset.openFem3dMaatLabel ?? "").length > 0,
      `een maatlabel op de rubberband: ${tekenvlak().dataset.openFem3dMaatLabel}`);
    info.push(`maatlabel van knoop 1 naar knoop 3: ${tekenvlak().dataset.openFem3dMaatLabel}`);
    await klik(scherm([2, 3, 0]));
    gelijk(stand.stappen, 1, "één stap ongedaan maken");
    gelijk(stand.model.nodes.length, 8, "één nieuwe knoop: het begin van de kopie is knoop 3 geworden");
    const kopie = stand.model.beams[1];
    gelijk([kopie?.id, kopie?.startNodeId], [2, 3], "staaf 2 begint op knoop 3 (automatisch samengevoegd)");
    gelijk(knoop(stand.model, kopie.endNodeId), [6, 3, 0], "het eind van de kopie: knoop 2 + (2; 3; 0)");
    gelijk(ketting(stand.model)[0], [1, 1, 2], "staaf 1 blijft waar hij was");
    gelijk(kopie.profileName, "HEA 200", "het profiel reist mee");
    gelijk(stand.model.supports.map((s) => s.nodeId), [1, 3], "de oplegging van knoop 1 reist mee naar knoop 3");
    gelijk(stand.selectie, { type: "beam", id: 2 }, "de kopie is geselecteerd");
    gelijk(stand.gereedschap, "select", "terug naar Selecteren");
  });

  await test("staaf 1 met plaat 1 naar een rasterpunt in het werkvlak: de verschuiving ligt op het raster", async () => {
    mount(<Werkruimte beginSelectie={{ type: "multi", nodeIds: [], beamIds: [1], plateIds: [1] }} />);
    await wacht(400);
    gelijk(kopUitleg(), BRON, "de kopregel vraagt het bronpunt");
    await klik(scherm([0, -3, 0]));
    gelijk(kopUitleg(), DOEL, "het bronpunt (knoop 4) is gekozen");
    await klik(scherm([6.5, 0.5, 0]));
    gelijk(stand.stappen, 1, "één stap");
    gelijk(stand.model.beams.length, 2, "één nieuwe staaf");
    gelijk(stand.model.plates?.length, 2, "één nieuwe plaat");
    const kopie = stand.model.beams[1];
    gelijk([knoop(stand.model, kopie.startNodeId), knoop(stand.model, kopie.endNodeId)], [[6.5, 3.5, 0], [10.5, 3.5, 0]],
      "de staaf verschoven over (6,5; 3,5; 0) m");
    gelijk(stand.model.plates![1].nodeIds.map((id) => knoop(stand.model, id)),
      [[6.5, 0.5, 0], [10.5, 0.5, 0], [10.5, 2.5, 0], [6.5, 2.5, 0]], "de plaat ook");
    gelijk(stand.selectie, { type: "multi", nodeIds: [], beamIds: [2], plateIds: [2] }, "de kopieën zijn geselecteerd");
  });

  await test("twee keer hetzelfde punt: geen kopie, het bronpunt blijft staan", async () => {
    mount(<Werkruimte beginSelectie={{ type: "beam", id: 1 }} />);
    await wacht(400);
    await klik(scherm([4, 0, 0]));
    await klik(scherm([4, 0, 0]));
    gelijk(stand.stappen, 0, "het model blijft");
    gelijk(kopUitleg(), DOEL, "nog steeds het doelpunt");
    gelijk(stand.gereedschap, "copy", "het gereedschap blijft Kopiëren");
    await klik(scherm([4, 2, 0]));
    gelijk(stand.stappen, 1, "het volgende punt kopieert alsnog, vanaf het eerste bronpunt");
    gelijk(knoop(stand.model, stand.model.beams[1].startNodeId), [0, 2, 0], "verschoven over (0; 2; 0) m");
  });

  await test("Esc na het bronpunt: terug naar Selecteren, niets gekopieerd", async () => {
    mount(<Werkruimte beginSelectie={{ type: "beam", id: 1 }} />);
    await wacht(400);
    await klik(scherm([0, 0, 0]));
    gelijk(kopUitleg(), DOEL, "het bronpunt is gekozen");
    flushSync(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await wacht(120);
    gelijk(stand.gereedschap, "select", "terug naar Selecteren");
    gelijk(stand.stappen, 0, "niets gekopieerd");
    ok(!paneel(), "het paneel is dicht");
  });

  await test("zonder selectie: de uitleg vraagt eerst een selectie, de eerste klik kiest de staaf, daarna bron- en doelpunt", async () => {
    mount(<Werkruimte />);
    await wacht(400);
    gelijk(kopUitleg(), "Selecteer eerst de knopen, staven of platen die je wilt kopiëren.", "de kopregel");
    ok(!paneel(), "nog geen paneel");
    await klik(scherm([2, 0, 0]));
    gelijk(stand.selectie, { type: "beam", id: 1 }, "de klik koos staaf 1");
    gelijk(stand.stappen, 0, "het model blijft");
    gelijk(kopUitleg(), BRON, "nu het bronpunt");
    await klik(scherm([0, 0, 0]));
    // Niet naar y = 3: dan ligt knoop 3 op de kopie en splitst het automatisch aansluiten haar.
    await klik(scherm([0, 1.5, 0]));
    gelijk(stand.stappen, 1, "één stap");
    gelijk(ketting(stand.model).map(([id]) => id), [1, 2], "staaf 2 is de kopie");
    gelijk(knoop(stand.model, stand.model.beams[1].startNodeId), [0, 1.5, 0], "verschoven over (0; 1,5; 0) m");
  });

  await test("met een selectie vult Shift- of Ctrl-klik de selectie aan in plaats van een punt te zetten; een bronpunt vervalt dan", async () => {
    mount(<Werkruimte beginSelectie={{ type: "beam", id: 1 }} />);
    await wacht(400);
    await klik(scherm([2, -2, 0]), { shiftKey: true });
    gelijk(stand.selectie, { type: "multi", nodeIds: [], beamIds: [1], plateIds: [1] }, "Shift+klik voegt plaat 1 toe");
    gelijk(stand.stappen, 0, "het model blijft");
    gelijk(stand.gereedschap, "copy", "het gereedschap blijft Kopiëren");
    gelijk(kopUitleg(), BRON, "geen bronpunt gezet");
    await klik(scherm([0, 0, 0]));
    gelijk(kopUitleg(), DOEL, "een gewone klik zet het bronpunt");
    gelijk(stand.selectie, { type: "multi", nodeIds: [], beamIds: [1], plateIds: [1] }, "de selectie blijft");
    await klik(scherm([2, -2, 0]), { ctrlKey: true });
    gelijk(stand.selectie, { type: "beam", id: 1 }, "Ctrl+klik haalt plaat 1 er weer uit");
    gelijk(kopUitleg(), BRON, "het bronpunt is vervallen: de selectie veranderde");
    gelijk(stand.stappen, 0, "niets gekopieerd");
    await klik(scherm([0, 0, 0]));
    await klik(scherm([0, 1.5, 0]));
    gelijk(stand.stappen, 1, "daarna kopiëren bron- en doelpunt gewoon");
    gelijk(stand.model.beams.length, 2, "alleen staaf 1 gekopieerd");
    gelijk(stand.model.plates?.length, 1, "plaat 1 niet");
  });

  await test("in de explodeweergave: geen puntuitleg maar de melding dat Exploderen uit moet, en een klik kiest", async () => {
    const melding = "Schakel Exploderen uit voordat je het model wijzigt.";
    mount(<Werkruimte beginSelectie={{ type: "beam", id: 1 }} zicht={{ ...ZICHT, explode: { mode: "levels", amountM: 2 } }} />);
    await wacht(400);
    gelijk(kopUitleg(), melding, "de kopregel");
    ok(paneel(), "het paneel Kopiëren staat open");
    gelijk(paneelUitleg(), melding, "het paneel");
    await klik(scherm([2, -2, 0]));
    gelijk(stand.selectie, { type: "plate", id: 1 }, "de klik kiest plaat 1 (geen bronpunt)");
    gelijk(stand.stappen, 0, "het model blijft");
    gelijk(kopUitleg(), melding, "nog steeds de melding, geen doelpunt");
  });

  await test("het lint: met ruimte genoeg geen afgekapte namen, in het 2D-lint Start en in de tabs Tabel en IFC (met hun eigen opmaak)", async () => {
    mount(<Lint dim="2d" breedte={1920} />);
    await wacht(200);
    ok(!lintInhoud().classList.contains("ribbon-tight") && !lintInhoud().classList.contains("ribbon-compact"),
      `2D in 1920 px: volledige namen (${lintGroepen().scrollWidth} px)`);
    gelijk(afgekapt(), [], "geen afgekapte naam in het 2D-lint Start");
    for (const [naam, tab] of [["Tabel", <TableTab />], ["IFC", <IfcTab />]] as const) {
      mount(<LintVak breedte={1920}>{tab}</LintVak>);
      await wacht(200);
      gelijk(afgekapt(), [], `geen afgekapte naam in de tab ${naam}`);
      // De dichtere opmaak van het lint Start geldt niet in de andere tabs.
      gelijk(getComputedStyle(container.querySelector<HTMLElement>(".ribbon-group")!).paddingLeft, "8px", `${naam}: groepsopvulling`);
      gelijk(getComputedStyle(container.querySelector<HTMLElement>(".ribbon-btn.small")!).minWidth, "70px", `${naam}: kleine knop`);
      gelijk(getComputedStyle(container.querySelector<HTMLElement>(".ribbon-btn-stack")!).display, "flex", `${naam}: knoppen onder elkaar`);
    }
  });

  await test("het lint: past het met volledige namen net niet, dan eerst ingekorte namen en nog geen pictogrammen", async () => {
    mount(<Lint dim="3d" breedte={3400} />);
    await wacht(200);
    ok(!lintInhoud().classList.contains("ribbon-tight") && !lintInhoud().classList.contains("ribbon-compact"),
      "3D in 3400 px: volledige namen");
    gelijk(afgekapt(), [], "geen afgekapte naam");
    const vol = lintGroepen().scrollWidth;
    const rand = lintVak().clientWidth - lintInhoud().clientWidth;
    lintVak().style.width = `${vol + rand - 40}px`;
    window.dispatchEvent(new Event("resize"));
    await wacht(200);
    ok(lintInhoud().classList.contains("ribbon-tight"), `${vol - 40} px: ingekorte namen`);
    ok(!lintInhoud().classList.contains("ribbon-compact"), `${vol - 40} px: nog geen pictogrammen`);
    ok(lintInhoud().scrollWidth <= lintInhoud().clientWidth, `ingekort past het: ${lintInhoud().scrollWidth} px`);
    ok(afgekapt().length > 0, "er zijn namen ingekort");
    ok(getComputedStyle(kleinLabel("Kopiëren")).display !== "none", "de naam bij Kopiëren staat er");
    info.push(`3D-lint ingekort: ${lintGroepen().scrollWidth} px (met volledige namen ${vol} px)`);
  });

  await test("het lint: elke knop houdt zijn naam voor schermlezers; past het lint niet, dan schuift het horizontaal", async () => {
    mount(<Lint dim="3d" breedte={700} />);
    await wacht(200);
    const knoppen = [...container.querySelectorAll<HTMLButtonElement>("button.ribbon-btn")];
    ok(knoppen.length > 20, `knoppen in het lint: ${knoppen.length}`);
    // Ontwerp 0.4: aria-label is de naam, of "<naam>. <uitleg>" als de knop een uitleg heeft.
    const zonderNaam = knoppen.filter((knop) => {
      const label = knop.querySelector(".ribbon-btn-label")?.textContent ?? "";
      const aria = knop.getAttribute("aria-label") ?? "";
      return label === "" || (aria !== label && !aria.startsWith(`${label}. `));
    });
    gelijk(zonderNaam.map((knop) => knop.getAttribute("aria-label")), [], "aria-label begint met het label");
    const kopieer = knoppen.find((knop) => knop.getAttribute("aria-label") === "Kopiëren");
    ok(kopieer, "de knop Kopiëren staat in het lint");
    ok(knoppen.every((knop) => knop.querySelector(".ribbon-btn-icon")?.getAttribute("aria-hidden") === "true"),
      "de pictogrammen zijn voor schermlezers verborgen");
    const inhoud = lintInhoud();
    gelijk(getComputedStyle(inhoud).overflowX, "auto", "het lint schuift horizontaal");
    ok(inhoud.scrollWidth > inhoud.clientWidth, `het 3D-lint is ook compact breder dan 700 px: ${inhoud.scrollWidth}`);
    info.push(`3D-lint compact: ${lintGroepen().scrollWidth} px`);
  });

  await test("het lint: alleen pictogrammen bij de kleine knoppen als het met namen niet past, en de namen terug zodra het wel past", async () => {
    mount(<Lint dim="3d" breedte={1600} />);
    await wacht(200);
    ok(lintInhoud().classList.contains("ribbon-compact"), "3D in 1600 px: compact");
    gelijk(getComputedStyle(kleinLabel("Kopiëren")).display, "none", "de naam bij Kopiëren is verborgen");
    ok(lintInhoud().scrollWidth <= lintInhoud().clientWidth, `compact past het 3D-lint in 1600 px: ${lintInhoud().scrollWidth}`);
    ok(getComputedStyle(grootLabel("Verplaatsen")).display !== "none", "een grote knop houdt zijn naam");
    // Breder venster: opnieuw meten, met namen. (Headless met virtuele tijd
    // tekent geen beeldjes, dus geen ResizeObserver: de venstergebeurtenis.)
    lintVak().style.width = "3400px";
    window.dispatchEvent(new Event("resize"));
    await wacht(200);
    ok(!lintInhoud().classList.contains("ribbon-compact"), `3D in 3400 px: met namen (${lintInhoud().scrollWidth} px)`);
    ok(getComputedStyle(kleinLabel("Kopiëren")).display !== "none", "de naam bij Kopiëren staat er");
    info.push(`3D-lint met namen: ${lintGroepen().scrollWidth} px`);
    lintVak().style.width = "1600px";
    window.dispatchEvent(new Event("resize"));
    await wacht(200);
    ok(lintInhoud().classList.contains("ribbon-compact"), "weer smaller: weer compact");
    // Het 2D-lint is smaller: in 1920 px past het met volledige namen.
    mount(<Lint dim="2d" breedte={1920} />);
    await wacht(200);
    ok(!lintInhoud().classList.contains("ribbon-compact") && !lintInhoud().classList.contains("ribbon-tight"),
      `2D in 1920 px: met volledige namen (${lintInhoud().scrollWidth} px)`);
    info.push(`2D-lint met namen: ${lintGroepen().scrollWidth} px`);
  });
}

/** Een linttab zoals Ribbon.tsx hem zet (container, wrapper, paneel), in een vak van deze breedte. */
function LintVak({ breedte, children }: { breedte: number; children: React.ReactNode }) {
  return <div className="lint-vak" style={{ width: breedte, background: "var(--theme-bg)" }}>
    <div className="ribbon-container" style={{ marginTop: 0 }}><div className="ribbon-content-wrapper"><div className="ribbon-content-panel">
      {children}
    </div></div></div>
  </div>;
}
/** Het lint Start in een vak van deze breedte. */
function Lint({ dim, breedte }: { dim: "2d" | "3d"; breedte: number }) {
  return <LintVak breedte={breedte}><HomeTab modelDimension={dim} canOpenFem3DDelete openFem3dTool="copy" /></LintVak>;
}
/** De zichtbare namen van kleine en middelgrote knoppen die niet in hun vak passen (afgekapt). */
const afgekapt = () => [...container.querySelectorAll<HTMLElement>(".ribbon-btn.small .ribbon-btn-label, .ribbon-btn.medium .ribbon-btn-label")]
  .filter((label) => getComputedStyle(label).display !== "none" && label.scrollWidth > label.clientWidth + 0.5)
  .map((label) => label.textContent);
const lintVak = () => container.querySelector<HTMLElement>(".lint-vak")!;
const lintInhoud = () => container.querySelector<HTMLElement>(".ribbon-content-home")!;
const lintGroepen = () => lintInhoud().querySelector<HTMLElement>(".ribbon-groups")!;
const lintKnop = (naam: string) => [...container.querySelectorAll<HTMLButtonElement>("button.ribbon-btn")]
  .find((knop) => knop.getAttribute("aria-label") === naam)!;
const kleinLabel = (naam: string) => {
  const knop = lintKnop(naam);
  ok(knop?.classList.contains("small"), `${naam} is een kleine knop`);
  return knop.querySelector<HTMLElement>(".ribbon-btn-label")!;
};
const grootLabel = (naam: string) => {
  const knop = lintKnop(naam);
  ok(knop && !knop.classList.contains("small") && !knop.classList.contains("medium"), `${naam} is een grote knop`);
  return knop.querySelector<HTMLElement>(".ribbon-btn-label")!;
};

/* ── Beelden voor de schermafbeeldingen ───────────────────────────────── */

async function toonBeeld(beeld: string) {
  if (beeld === "kopie") {
    // Staaf 1 geselecteerd, het bronpunt op knoop 1 en de muis op knoop 3:
    // de rubberband met maatlabel, de uitleg en het paneel Kopiëren.
    mount(<Werkruimte beginSelectie={{ type: "beam", id: 1 }} zicht={{ ...ZICHT, nodeNumbers: true, beamNumbers: true }} />);
    await wacht(500);
    await klik(scherm([0, 0, 0]));
    await wijs(scherm([2, 3, 0]));
    await wacht(400);
    return;
  }
  if (beeld === "lint") {
    // Het lint Start (3D, of 2D met #dim=2d) over de volle vensterbreedte, met Kopiëren actief.
    const dim = new URLSearchParams(location.hash.slice(1)).get("dim") === "2d" ? "2d" : "3d";
    mount(<Lint dim={dim} breedte={window.innerWidth} />);
    await wacht(500);
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, info, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, info, error: String(e?.stack ?? e) }); });
