/**
 * Browserkant van test-open-fem3d-selectie-ui.mjs: het echte 3D-tekenvlak
 * (ThreeFrameCanvas, WebGL) en de echte 3D-editor in een lokale headless
 * browser, met echte PointerEvents en toetsen.
 *
 *  - één klik op of tot 4 px naast een staaf selecteert die staaf, ook in de
 *    staalhal van 60 × 30 m in profielweergave en bij dunne buisverbanden;
 *  - een knoop wint alleen als de klik op de knoop valt; een last alleen als
 *    hij niet ver achter de aangeklikte staaf ligt; een randstaaf wint vlak
 *    naast zich van de plaat;
 *  - een lijnlast is ook op de dunne pijlsteel en de staartlijn aanklikbaar;
 *    een klik op een opleggingsteken selecteert de knoop;
 *  - crossing (van rechts naar links) tegenover venster, met het getekende kader;
 *  - rechts slepen draait om het midden van de selectie;
 *  - Escape: uit het gereedschap, daarna selectie weg; Delete verwijdert een
 *    plaat met opening, Ctrl+Z (historie) zet haar terug;
 *  - view cube (groep "kubus", eigen browserproces): het gebouwtje (dak,
 *    gevels, vloer, deur, maaiveld), Dak/Voor/Rechts = de lintaanzichten,
 *    hoek en ribbe langs de som van de normalen, slepen (ook tot buiten de
 *    kubus, en vanuit Onder zonder omslag), schermposities (niet gespiegeld),
 *    het menu ▾ (Startaanzicht, Passend beeld; muis en toetsenbord), Passend
 *    beeld behoudt de richting, focus alleen op de voorkant (en zichtbaar),
 *    een klik zet de focus (invoerveld los, tabstop op het aangeklikte doel),
 *    het open menu houdt zijn toetsen (Delete, letters), namen op dak en
 *    vloer op ware grootte even hoog als op de gevels, de arcering schuin,
 *    contrast in alle thema's, ligging naast Views, Passend beeld, tekenfout
 *    en panelen,
 *    labels onder kubus en menu verborgen, zichtbaarheid viewCube. Klikken
 *    op knoppen gaan met echte pointer-events op het midden van het element,
 *    na een hit-test (document.elementFromPoint);
 *  - perspectief of parallel (groep "parallel", eigen browserproces): in
 *    parallelle projectie kiest een klik de staaf, knoop, plaat of last, pakt
 *    het kader wat er in beeld in valt, houdt de wielzoom het punt onder de
 *    muis vast, pant de scrollknop één op één, draait rechts slepen om de
 *    selectie, landen oplegging en veer op het werkvlak of de knoop, blijft
 *    de camera vóór een gegroeid model, toont passend beeld alle
 *    knopen met de marge van perspectief; het menu-item Perspectief wisselt
 *    heen en terug met behoud van doel, richting en zichtbare grootte; de
 *    kubus volgt; views herstellen
 *    hun schaal; de zichtbaarheid perspective en de diagnose. Bij knopen
 *    precies achter elkaar kiezen klik en tekensnap de voorste; bij een lage
 *    kijkhoek is het werkvlak tot onderin te raken. Het tekenvlak tekent echt
 *    met de camera uit de diagnose (rendercamera vergeleken);
 *  - React StrictMode (groep "strikt", ontwikkelbundel): een lintaanzicht bij
 *    het mounten blijft staan als de scène tweemaal wordt opgebouwd;
 *  - een lijnlast kiezen (groep "lijnlast", issue #81): een klik op elke
 *    pijl, op de pijlpunt vlak boven de staaf of op de staartlijn selecteert
 *    de hele last en markeert al zijn pijlen en zijn staartlijn (elk deel
 *    geteld), ook bij een trapeziumvormige last over een deel van de ligger;
 *    met en zonder GPU-batches, ook bij 120 staven, in perspectief en
 *    parallel; wisselen naar een andere last en deselecteren zetten elk deel
 *    terug in zijn eigen kleur, zonder de scène opnieuw op te bouwen; idem
 *    een puntlast, een temperatuurlast en een knooplast;
 *  - Waarden bij de snedekrachtlijnen (groep "waarden", issue #95): het aantal
 *    momentlabels per stand (1 < 2 < 3 < 4 < 5, stand 3 = vóór #95), Waarden
 *    uit = geen getallen maar wel de lijnen, een geselecteerde staaf toont zijn
 *    waarden ook in stand 1, geen label over de view cube, in stand 5 zichtbare
 *    kwartpunten, de instelling via de editor naar het tekenvlak, een groot
 *    model (1200 staven, stand 5) met alleen de labels die in beeld passen als
 *    element, en in de verkenner het sub-blok Waarden onder de eerste
 *    aangevinkte lijn, ook op 240 px breed (nl en fr).
 *  - Scharnieren aan staafeinden en het inklemmingsteken (groep "scharnier",
 *    issue #93): het bolletje op de staafas net vóór de knoopbol bij elk
 *    staafeind met een scharnier (los en in een GPU-batch, kiesbaar als de
 *    staaf, mee gekleurd bij selecteren), met de getekende rand kleiner dan
 *    de knoopbol en dikker dan de staaf, ook in een klein portaal; in de
 *    profielweergave door het eigen profiel heen te zien maar achter een
 *    profiel ervoor niet (beeldpunten); geen bolletjes zonder scharnier of
 *    met de staven uit, ook langs de snelle wegen zonder opnieuw te mounten
 *    (staven en profielen aan/uit, een knoop verplaatsen); het gereedschap Scharnier aan
 *    staafeind in de echte editor (een klik bij het begin of het eind zet My
 *    en Mz los en weer vast, één stap ongedaan maken per klik, de uitleg in
 *    de kop); de inklemming als blok met kraag op de gearceerde ondergrond,
 *    los en gebundeld, met een klik erop de knoop.
 *
 * Zonder hash draait de testreeks; `#diag` telt alleen hoe vaak één klik op of
 * naast een staaf van de staalhal die staaf selecteert; `#beeld=…` toont
 * alleen een beeld voor een schermafbeelding (vervormd, kubus-start,
 * kubus-onder, kubus-menu, scharnier-overzicht, scharnier-iso,
 * scharnier-opzij, scharnier-klein, scharnier-profiel, inklemming-iso,
 * inklemming-opzij, inklemming-boven, opleggingen-naast-elkaar).
 */
import React, { useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as THREE from "three";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import commonEn from "../src/i18n/locales/en/common.json";
import ribbonEn from "../src/i18n/locales/en/ribbon.json";
import commonDe from "../src/i18n/locales/de/common.json";
import ribbonDe from "../src/i18n/locales/de/ribbon.json";
import commonFr from "../src/i18n/locales/fr/common.json";
import ribbonFr from "../src/i18n/locales/fr/ribbon.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import { openFem3DConditionMarkerSize } from "../src/components/openFem3d/openFem3dMarkers";
import {
  addOpenFem3DPlate, addOpenFem3DPlateOpening, addOpenFem3DSurfaceLoad, OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel,
  pinOpenFem3DBeamsToColumns, type OpenFem3DModel,
} from "../src/components/openFem3d/openFem3dModel";
import {
  DEFAULT_OPEN_FEM_3D_VISIBILITY, OPEN_FEM_3D_RESULT_LAYERS, readOpenFem3DVisibility, saveOpenFem3DVisibility,
  type OpenFem3DVisibility,
} from "../src/components/openFem3d/openFem3dVisibility";
import OpenFem3DVisibilityDialog from "../src/components/openFem3d/OpenFem3DVisibilityDialog";
import ExplorerViewTab from "../src/components/fem/ExplorerViewTab";
import { parseOpenFem3DViewSets } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DTool, OpenFem3DView } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import { openFem3dHistoryReducer } from "../src/components/openFem3d/openFem3dHistory";
import type { OpenFem3DNodeTarget } from "../src/components/openFem3d/openFem3dNodeTools";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import {
  openFem3DAutoDeformationScale, type OpenFem3DDeformationDisplay,
} from "../src/components/openFem3d/openFem3dDeformationDisplay";
import OpenFem3DExplorer from "../src/components/openFem3d/OpenFem3DExplorer";
import type { OpenFem3DDiagramLabels } from "../src/components/openFem3d/openFem3dDiagramLabels";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_STRUCTURAL_GRID } from "../src/components/fem/femTypes";
// @ts-expect-error -- esbuild laadt het projectbestand als tekst
import staalhalTekst from "../../docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden;
// de capture zelf is hier niet het onderwerp.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

// De camera waarmee het tekenvlak echt tekent. WebGLRenderer zet `render` in
// zijn constructor als eigen eigenschap (this.render = …); een setter op het
// prototype vangt die toewijzing en omwikkelt de functie. Zo kunnen de
// proeven beeld (rendercamera) en kiezen (camera uit de diagnose) vergelijken.
let renderCamera: THREE.Camera | null = null;
// De scène die het laatst getekend is: de lijnlastproeven (#81) lezen daarin
// de kleur van elke pijl, zoals hij op het scherm komt.
let renderScene: THREE.Object3D | null = null;
// De renderer die het laatst tekende: de scharnierproeven (#93) lezen er
// beeldpunten mee uit (beeldpunt).
let renderRenderer: THREE.WebGLRenderer | null = null;
let rendererTeller = 0;
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  set(this: THREE.WebGLRenderer, fn: (scene: THREE.Object3D, camera: THREE.Camera) => void) {
    rendererTeller += 1;
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
const tests: { name: string; error?: string; ms?: number }[] = [];
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
async function test(name: string, fn: () => void | Promise<void>) {
  const gekozen = /test=(\d+)/.exec(location.hash)?.[1];
  if (gekozen && ++testNummer !== Number(gekozen)) return;
  document.body.dataset.openFem3dCurrentTest = name;
  const start = performance.now();
  try { await fn(); tests.push({ name, ms: Math.round(performance.now() - start) }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - start) }); }
  document.body.dataset.openFem3dCompletedTests = String(tests.length);
}
let testNummer = 0;

const staalhal: OpenFem3DModel = parseOpenFem3DModel(JSON.parse(staalhalTekst as string).model3d);
const snel: OpenFem3DVisibility = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, nodeNumbers: false, grid: false, structuralGrid: false };

// ── Het tekenvlak met eigen selectie- en gereedschapstoestand ──────────────
let selectie: OpenFem3DSelection = null;
let gereedschap: OpenFem3DTool = "select";
let zetGereedschap: (tool: OpenFem3DTool) => void = () => {};
let geplaatst: OpenFem3DNodeTarget[] = [];
// Wat het tekenvlak na een camera-interactie meldt (opslaan en aanzicht).
let cameraOpgeslagen: OpenFem3DCameraState | null = null;
let gemeldAanzicht: OpenFem3DView | null = null;
// Het laatste model dat het tekenvlak doorgaf (onChange; het tekenvlak zelf houdt zijn model).
let gewijzigd: OpenFem3DModel | null = null;
// Waarden bij de snedekrachtlijnen en de selectie van buitenaf zetten (groep "waarden").
let zetWaarden: (labels: OpenFem3DDiagramLabels | undefined) => void = () => {};
let zetTekenvlakSelectie: (next: OpenFem3DSelection) => void = () => {};
// Een andere camera zonder opnieuw te mounten (elke aanroep een nieuw verzoek).
let zetTekenvlakCamera: (state: OpenFem3DCameraState) => void = () => {};
// Vaste lege benuttingen, zoals de editor ze stabiel doorgeeft (useMemo). De
// standaardwaarde van het tekenvlak is bij elke render een nieuwe array; dan
// bouwt elke selectiewijziging de hele scène opnieuw op en wordt het kleuren
// bij selecteren en deselecteren nooit uitgevoerd (#81).
const GEEN_BENUTTINGEN: never[] = [];
function Tekenvlak({ model, visibility, activeLoadCaseId, camera, workPlaneZ, result, deformationDisplay, viewRequest, diagramLabels }: {
  model: OpenFem3DModel; visibility: OpenFem3DVisibility; activeLoadCaseId?: number; camera?: OpenFem3DCameraState;
  workPlaneZ?: number; result?: OpenFem3DSolveResult | null; deformationDisplay?: OpenFem3DDeformationDisplay;
  viewRequest?: { kind: OpenFem3DView; token: number }; diagramLabels?: OpenFem3DDiagramLabels;
}) {
  const [sel, setSel] = useState<OpenFem3DSelection>(null);
  const [tool, setTool] = useState<OpenFem3DTool>("select");
  const [waarden, setWaarden] = useState(diagramLabels);
  const [cameraVerzoek, setCameraVerzoek] = useState(camera ? { state: camera, token: 1 } : undefined);
  zetGereedschap = (next) => { gereedschap = next; setTool(next); };
  zetWaarden = setWaarden;
  zetTekenvlakSelectie = (next) => { selectie = next; setSel(next); };
  zetTekenvlakCamera = (state) => setCameraVerzoek((vorig) => ({ state, token: (vorig?.token ?? 0) + 1 }));
  return <div className="open-fem3d-stage" style={{ width: BREED, height: HOOG, flex: "none" }}>
    <ThreeFrameCanvas
      model={model} onChange={(next) => { gewijzigd = next; }} tool={tool} selection={sel}
      onSelect={(next) => { selectie = next; setSel(next); }}
      onToolChange={(next) => { gereedschap = next; setTool(next); }}
      onPlaceNodeCondition={(target) => { geplaatst.push(target); }}
      fitToken={0} visibility={visibility} activeLoadCaseId={activeLoadCaseId} workPlaneZ={workPlaneZ}
      result={result} deformationDisplay={deformationDisplay} viewRequest={viewRequest} diagramLabels={waarden}
      utilizations={GEEN_BENUTTINGEN} cameraRequest={cameraVerzoek}
      onCameraChange={(state) => { cameraOpgeslagen = state; }}
      onCameraViewChange={(view) => { gemeldAanzicht = view; }}
    />
  </div>;
}
async function toon(model: OpenFem3DModel, visibility: OpenFem3DVisibility, extra: {
  activeLoadCaseId?: number; camera?: OpenFem3DCameraState; workPlaneZ?: number;
  result?: OpenFem3DSolveResult | null; deformationDisplay?: OpenFem3DDeformationDisplay;
  viewRequest?: { kind: OpenFem3DView; token: number }; diagramLabels?: OpenFem3DDiagramLabels;
} = {}) {
  selectie = null;
  gereedschap = "select";
  cameraOpgeslagen = null;
  gemeldAanzicht = null;
  gewijzigd = null;
  mount(<Tekenvlak model={model} visibility={visibility} {...extra} />);
  await wacht(200);
}

const canvasEl = () => container.querySelector("canvas") as HTMLCanvasElement;
const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;
const kaderEl = () => container.querySelector(".open-fem3d-selection-box") as HTMLDivElement;
/**
 * De camera van het tekenvlak, nagebouwd uit zijn diagnose: perspectief, of
 * parallel (data-open-fem3d-projection) met de halve hoogte uit de diagnose.
 */
function camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  const ds = tekenvlakEl().dataset;
  const vec = (s: string | undefined) => new THREE.Vector3(...(s ?? "0,0,0").split(",").map(Number));
  const h = Number(ds.openFem3dOrthoHalfHeight);
  const cam = ds.openFem3dProjection === "orthographic"
    ? new THREE.OrthographicCamera(-h * BREED / HOOG, h * BREED / HOOG, h, -h, 0, 1e7)
    : new THREE.PerspectiveCamera(50, BREED / HOOG, 0.01, 100000);
  cam.up.copy(vec(ds.openFem3dCameraUp));
  cam.position.copy(vec(ds.openFem3dCameraPosition));
  cam.lookAt(vec(ds.openFem3dCameraTarget));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}
type Pt = { x: number; y: number };
function scherm(cam: THREE.Camera, p: { x: number; y: number; z: number }): Pt {
  const n = new THREE.Vector3(p.x, p.y, p.z).project(cam);
  return { x: (n.x + 1) * BREED / 2, y: (1 - n.y) * HOOG / 2 };
}
function wijzer(type: string, p: Pt, knop = 0, knoppen = 0, extra: PointerEventInit = {}) {
  const canvas = canvasEl();
  const rect = canvas.getBoundingClientRect();
  flushSync(() => {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: rect.left + p.x, clientY: rect.top + p.y, button: knop, buttons: knoppen,
      pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true, ...extra,
    }));
  });
}
function klik(p: Pt, extra: PointerEventInit = {}) {
  wijzer("pointerdown", p, 0, 1, extra);
  wijzer("pointerup", p, 0, 0, extra);
}
function toets(key: string, doel: EventTarget = window) {
  flushSync(() => { doel.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
}

// ── View cube (issue #85) ─────────────────────────────────────────────────
const kubusEl = () => container.querySelector<HTMLElement>(".open-fem3d-view-cube")!;
/**
 * Een schermpunt (client) waar de kubus het doel `id` laat zien, gevonden met
 * de echte hit-test van de browser (CSS 3D, achterkanten verborgen): het
 * midden van een cel van dat doel waar `elementFromPoint` die cel ook raakt.
 */
function kubusPunt(id: string): { x: number; y: number; el: HTMLElement } {
  const cellen = [...kubusEl().querySelectorAll<HTMLElement>(`.open-fem3d-view-cube-cel[data-open-fem3d-view-cube-doel="${id}"]`)];
  for (const cel of cellen) {
    const r = cel.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const raak = document.elementFromPoint(x, y);
    if (raak instanceof HTMLElement && raak.dataset.openFem3dViewCubeDoel === id) return { x, y, el: raak };
  }
  throw Error(`doel ${id} is niet aan te klikken op de kubus`);
}
function kubusWijzer(type: string, el: Element, x: number, y: number, knop = 0, knoppen = 0) {
  flushSync(() => {
    el.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, button: knop, buttons: knoppen,
      pointerId: 7, pointerType: "mouse", bubbles: true, cancelable: true,
    }));
  });
}
/** Klik op een doel van de kubus; `beweging` px tussen indrukken en loslaten. */
function kubusKlik(id: string, beweging = 0) {
  const p = kubusPunt(id);
  kubusWijzer("pointerdown", p.el, p.x, p.y, 0, 1);
  if (beweging) kubusWijzer("pointermove", p.el, p.x + beweging, p.y, 0, 1);
  kubusWijzer("pointerup", p.el, p.x + beweging, p.y, 0, 0);
}
const cameraTekst = () => {
  const ds = tekenvlakEl().dataset;
  return [ds.openFem3dCameraPosition, ds.openFem3dCameraTarget, ds.openFem3dCameraUp];
};
const vector = (s: string | undefined) => new THREE.Vector3(...(s ?? "0,0,0").split(",").map(Number));
/** Camera − doel, uit de diagnose van het tekenvlak. */
const cameraOffset = () => vector(tekenvlakEl().dataset.openFem3dCameraPosition).sub(vector(tekenvlakEl().dataset.openFem3dCameraTarget));
function richtingIs(verwacht: number[], m: string) {
  const r = cameraOffset().normalize();
  const v = new THREE.Vector3(...verwacht).normalize();
  ok(r.distanceTo(v) < 1e-5, `${m}: richting ${r.toArray().map((x) => x.toFixed(4)).join(", ")} ≠ ${v.toArray().map((x) => x.toFixed(4)).join(", ")}`);
}
const afstandTotLijnstuk = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const r = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - r * dx, p.y - a.y - r * dy);
};
const binnenBeeld = (p: Pt) => p.x > 20 && p.y > 60 && p.x < BREED - 20 && p.y < HOOG - 60;

/**
 * Klikpunten op en naast staven waar de keuze eenduidig is: geen andere
 * staaf binnen 8 px van het klikpunt en geen knoop binnen 9 px.
 */
function klikpunten(model: OpenFem3DModel, cam: THREE.Camera, filter: (beam: OpenFem3DModel["beams"][number]) => boolean,
  fracties: number[], verschuivingen: number[], maximum: number) {
  const knopen = new Map(model.nodes.map((n) => [n.id, n]));
  const lijnen = model.beams.map((b) => ({ beam: b, a: scherm(cam, knopen.get(b.startNodeId)!), e: scherm(cam, knopen.get(b.endNodeId)!) }));
  const knoopPunten = model.nodes.map((n) => scherm(cam, n));
  const punten: { beamId: number; p: Pt; verschuiving: number }[] = [];
  for (const lijn of lijnen) {
    if (!filter(lijn.beam)) continue;
    const lengte = Math.hypot(lijn.e.x - lijn.a.x, lijn.e.y - lijn.a.y);
    if (lengte < 30) continue;
    const nx = -(lijn.e.y - lijn.a.y) / lengte, ny = (lijn.e.x - lijn.a.x) / lengte;
    for (const t of fracties) {
      for (const d of verschuivingen) {
        const p = { x: lijn.a.x + t * (lijn.e.x - lijn.a.x) + nx * d, y: lijn.a.y + t * (lijn.e.y - lijn.a.y) + ny * d };
        if (!binnenBeeld(p)) continue;
        if (lijnen.some((ander) => ander.beam.id !== lijn.beam.id && afstandTotLijnstuk(p, ander.a, ander.e) < 8)) continue;
        if (knoopPunten.some((k) => Math.hypot(k.x - p.x, k.y - p.y) < 9)) continue;
        punten.push({ beamId: lijn.beam.id, p, verschuiving: d });
      }
    }
  }
  // Gelijkmatig uitdunnen: elke klik rendert, en SwiftShader is geen GPU.
  const stap = Math.max(1, Math.ceil(punten.length / maximum));
  return punten.filter((_, index) => index % stap === 0);
}
function trefKans(punten: ReturnType<typeof klikpunten>) {
  const missers: string[] = [];
  for (const punt of punten) {
    selectie = null;
    klik(punt.p);
    const s = selectie as OpenFem3DSelection;
    if (!(s?.type === "beam" && s.id === punt.beamId)) {
      missers.push(`staaf ${punt.beamId} (${punt.verschuiving} px) → ${s ? `${s.type} ${"id" in s ? s.id : ""}` : "niets"}`
        + ` [${tekenvlakEl().dataset.openFem3dPickReason}]`);
    }
  }
  return missers;
}

// Synthetische modellen.
const tweeLiggers = parseOpenFem3DModel({
  // Voorste ligger V op z = 0,5; achterste ligger A tien meter verder met een
  // lijnlast (pijlen van boven naar z = 0).
  nodes: [
    { id: 1, x: 0, y: 0, z: 0.5 }, { id: 2, x: 6, y: 0, z: 0.5 },
    { id: 3, x: 0, y: 10, z: 0 }, { id: 4, x: 6, y: 10, z: 0 },
  ],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }],
  memberLoads: [{ id: 7, beamId: 2, qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: 6 }],
});
const vloer = addOpenFem3DPlate(parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 2, endNodeId: 3 },
    { id: 3, startNodeId: 3, endNodeId: 4 }, { id: 4, startNodeId: 4, endNodeId: 1 },
  ],
}), [1, 2, 3, 4], { thicknessM: 0.2 });
const portaal = parseOpenFem3DModel({
  nodes: [{ id: 1, x: -5, y: 0, z: 0 }, { id: 2, x: 5, y: 0, z: 0 }, { id: 3, x: 6, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 6 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }],
});
const editorZicht: OpenFem3DVisibility = { ...snel };
const editorCamera: OpenFem3DCameraState = { position: [3, -5, 9], target: [3, 2, 0], up: [0, 0, 1] };
const vooraanzicht = (x: number, z: number, afstand: number): OpenFem3DCameraState => ({
  position: [x, -afstand, z], target: [x, 0, z], up: [0, 0, 1],
});

// Een ligger (IPE 200) en een buis (CHS 88,9 × 4) met een verzonnen, maar
// geldige uitkomst: het einde van de ligger zakt 20 mm, de buis schuift op.
const vervormModel = parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 0, y: 3, z: 0 }, { id: 4, x: 6, y: 3, z: 0 }],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 200", material: "S235" },
    { id: 2, startNodeId: 3, endNodeId: 4, profileName: "CHS 88.9x4", material: "S235" },
  ],
});
const vervormResultaat = {
  schemaVersion: 1, engine: { id: "proef", name: "proef", revision: "0", license: "-" }, analysis: "linear",
  displacements: [
    { nodeId: 1, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 },
    { nodeId: 2, ux: 0, uy: 0, uz: -0.02, rx: 0, ry: 0.004, rz: 0 },
    { nodeId: 3, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 },
    { nodeId: 4, ux: 0, uy: 0.01, uz: 0, rx: 0, ry: 0, rz: 0.002 },
  ],
  reactions: [], memberForces: [], buckling: { status: "unavailable", modes: [] }, diagnostics: [],
} as unknown as OpenFem3DSolveResult;
const vervormZicht: OpenFem3DVisibility = { ...snel, profiles: true, deformation: true, reactions: false, utilization: false, loads: false };
const vervormCamera: OpenFem3DCameraState = { position: [3, -9, 6], target: [3, 1.5, 0], up: [0, 0, 1] };

async function diagnose() {
  const uitkomst: Record<string, unknown> = {};
  for (const [naam, visibility] of [
    ["analytisch", { ...snel, loads: false }], ["profielen", { ...snel, profiles: true, loads: false }],
  ] as const) {
    await toon(staalhal, visibility);
    const punten = klikpunten(staalhal, camera(), () => true, [0.5, 0.4], [0, 4], 60);
    uitkomst[naam] = { klikken: punten.length, missers: trefKans(punten) };
  }
  return uitkomst;
}

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", defaultNS: "common", initImmediate: false,
    resources: {
      nl: { common, ribbon }, en: { common: commonEn, ribbon: ribbonEn },
      de: { common: commonDe, ribbon: ribbonDe }, fr: { common: commonFr, ribbon: ribbonFr },
    },
  });
  // Alleen een beeld (voor een schermafbeelding): de vervormde vorm van dichtbij.
  if (location.hash === "#beeld=vervormd") {
    document.getElementById("uitslag")!.remove();
    await toon(vervormModel, vervormZicht, { result: vervormResultaat,
      camera: { position: [7.5, -4.2, 2.6], target: [3, 1.2, -0.2], up: [0, 0, 1] } });
    return;
  }
  // De view cube driemaal vergroot: startaanzicht (met een ribbe onder de
  // muis), van onderen, of met het menu open (tweede regel gefocust).
  const kubusBeeld = /^#beeld=kubus-(start|onder|menu)$/.exec(location.hash)?.[1];
  if (kubusBeeld) {
    // De uitslag blijft tot het eind staan: een fout komt zo in beeld.
    await toonEditor(portaal, { ...snel }, { camera: kubusBeeld === "onder" ? vanuit([1.4, -1.4, -1]) : undefined });
    if (kubusBeeld === "start") {
      const p = kubusPunt("+x+z");
      kubusWijzer("pointerover", p.el, p.x, p.y);
    }
    if (kubusBeeld === "menu") {
      klikEcht(menuKnopEl(), "knop ▾");
      toets("ArrowDown", actiefEl());
    }
    kubusEl().style.zoom = "3";
    document.getElementById("uitslag")!.remove();
    return;
  }
  // Scharnierbolletjes en opleggingstekens van dichtbij (#93).
  const scharnierBeeld = /^#beeld=((?:scharnier|inklemming)-\w+|opleggingen-naast-elkaar)$/.exec(location.hash)?.[1];
  if (scharnierBeeld) {
    const beeld = SCHARNIER_BEELDEN[scharnierBeeld];
    ok(beeld, `onbekend beeld ${scharnierBeeld}`);
    await toon(beeld!.model, { ...snel, perspective: beeld!.parallel !== true, ...beeld!.zicht }, { camera: beeld!.camera });
    document.getElementById("uitslag")!.remove();
    return;
  }
  if (location.hash === "#diag") {
    const uitkomst = await diagnose();
    document.getElementById("uitslag")!.textContent = JSON.stringify({ diag: uitkomst, tests: [], error: null });
    return;
  }

  // Drie groepen, elk in een eigen browserproces: de staalhal (veel klikken,
  // zware scène in SwiftShader), de kleine modellen en de view cube.
  const groep = /groep=(\w+)/.exec(location.hash)?.[1] ?? "alles";
  if (groep === "alles" || groep === "groot") await grootModel();
  if (groep === "alles" || groep === "klein") await kleineModellen();
  if (groep === "alles" || groep === "kubus") await kubusProeven();
  if (groep === "alles" || groep === "parallel") await parallelProeven();
  if (groep === "alles" || groep === "waarden") await waardenProeven();
  if (groep === "alles" || groep === "lijnlast") await lijnlastProeven();
  if (groep === "alles" || groep === "scharnier") await scharnierProeven();
  // Alleen in de ontwikkelbundel (test-open-fem3d-selectie-ui.mjs bouwt die apart).
  if (groep === "strikt") await strikteProeven();
}

async function grootModel() {
  await test("staalhal in profielweergave: één klik op of 4 px naast een staaf selecteert die staaf", async () => {
    await toon(staalhal, { ...snel, profiles: true, loads: false });
    const punten = klikpunten(staalhal, camera(), () => true, [0.5, 0.4], [0, 4, -4], 27);
    ok(punten.length >= 20, `te weinig eenduidige klikpunten (${punten.length})`);
    const missers = trefKans(punten);
    gelijk(missers, [], `${missers.length} van ${punten.length} klikken misten`);
  });

  await test("staalhal analytisch: idem (dunne assen, grote afstand)", async () => {
    await toon(staalhal, { ...snel, loads: false });
    const punten = klikpunten(staalhal, camera(), () => true, [0.5, 0.35], [0, 4, -4], 21);
    ok(punten.length >= 15, `te weinig eenduidige klikpunten (${punten.length})`);
    gelijk(trefKans(punten), [], "missers");
  });

  await test("buisverbanden (CHS 88,9) in het kopvak: één klik op of 4 px naast de buis", async () => {
    // Van boven op het dak van het eerste vak (x 0–6 m).
    await toon(staalhal, { ...snel, profiles: true, loads: false },
      { camera: { position: [3, 7.5, 30], target: [3, 7.5, 8.75], up: [0, 1, 0] } });
    const punten = klikpunten(staalhal, camera(), (b) => (b.profileName ?? "").startsWith("CHS"), [0.3, 0.7], [0, 4, -4], 21);
    ok(punten.length >= 12, `te weinig klikpunten op buizen (${punten.length})`);
    gelijk(trefKans(punten), [], "missers");
  });

  await test("knoop wint alleen op de knoop: 5,5 px ernaast op de staaf kiest de staaf", async () => {
    await toon(staalhal, { ...snel, loads: false });
    const cam = camera();
    const knopen = new Map(staalhal.nodes.map((n) => [n.id, n]));
    const lijnen = staalhal.beams.map((b) => ({ id: b.id, start: b.startNodeId, a: scherm(cam, knopen.get(b.startNodeId)!), e: scherm(cam, knopen.get(b.endNodeId)!) }));
    const knoopPunten = staalhal.nodes.map((n) => ({ id: n.id, p: scherm(cam, n) }));
    let getest = 0;
    for (const lijn of lijnen) {
      if (getest >= 6) break;
      const lengte = Math.hypot(lijn.e.x - lijn.a.x, lijn.e.y - lijn.a.y);
      if (lengte < 40 || !binnenBeeld(lijn.a)) continue;
      const p = { x: lijn.a.x + (lijn.e.x - lijn.a.x) * 5.5 / lengte, y: lijn.a.y + (lijn.e.y - lijn.a.y) * 5.5 / lengte };
      if (lijnen.some((ander) => ander.id !== lijn.id && afstandTotLijnstuk(p, ander.a, ander.e) < 4)) continue;
      if (knoopPunten.some((k) => k.id !== lijn.start && Math.hypot(k.p.x - p.x, k.p.y - p.y) < 12)) continue;
      selectie = null;
      klik(p);
      gelijk(selectie, { type: "beam", id: lijn.id }, `5,5 px van knoop ${lijn.start} op staaf ${lijn.id}`);
      selectie = null;
      klik(lijn.a);
      gelijk(selectie, { type: "node", id: lijn.start }, `klik op knoop ${lijn.start}`);
      getest += 1;
    }
    ok(getest >= 5, `te weinig knopen getest (${getest})`);
  });

  // Wind dwars (geval 3) op kolom 1 (knoop 1 → 3, 8 m): negen pijlen in +y naar
  // de staafas, staarten op y = -L. Onder knoop 1 een inklemming.
  const windZicht = { ...snel, profiles: true };
  const windCamera: OpenFem3DCameraState = { position: [7, -7, 6], target: [0, 0, 3.5], up: [0, 0, 1] };
  const tekenMaat = openFem3DConditionMarkerSize(staalhal.nodes);
  await test("lijnlast: een klik op de dunne pijlsteel of op de staartlijn selecteert de last", async () => {
    await toon(staalhal, windZicht, { activeLoadCaseId: 3, camera: windCamera });
    const cam = camera();
    const L = 1.8 * tekenMaat;
    for (const z of [2, 4, 6]) {
      selectie = null;
      klik(scherm(cam, { x: 0, y: -0.55 * L, z }));
      gelijk(selectie, { type: "memberLoad", id: 391 }, `midden van de pijlsteel op z = ${z}`);
    }
    selectie = null;
    klik(scherm(cam, { x: 0, y: -L, z: 4.5 }));
    gelijk(selectie, { type: "memberLoad", id: 391 }, "staartlijn tussen twee pijlen");
  });

  await test("lijnlast: een klein crossing-kader over de staartlijn, zonder geometrie erin, selecteert de last", async () => {
    await toon(staalhal, windZicht, { activeLoadCaseId: 3, camera: windCamera });
    const cam = camera();
    const staart = scherm(cam, { x: 0, y: -1.8 * tekenMaat, z: 4.5 });
    const rechtsBoven = { x: staart.x + 22, y: staart.y - 17 }, linksOnder = { x: staart.x - 3, y: staart.y };
    selectie = null;
    wijzer("pointerdown", rechtsBoven, 0, 1);
    wijzer("pointermove", linksOnder, 0, 1);
    gelijk(kaderEl().dataset.modus, "crossing", "van rechts naar links");
    wijzer("pointerup", linksOnder, 0, 0);
    gelijk(selectie, { type: "memberLoad", id: 391 }, "crossing over de staartlijn");
  });

  await test("lijnlast uitgezoomd: 3 px naast de pijlsteel (dunner dan een pixel) selecteert de last", async () => {
    await toon(staalhal, windZicht, { activeLoadCaseId: 3, camera: { position: [21, -21, 14], target: [0, 0, 3.5], up: [0, 0, 1] } });
    const cam = camera();
    const L = 1.8 * tekenMaat;
    for (const z of [3, 5]) {
      const staart = scherm(cam, { x: 0, y: -L, z });
      const punt = scherm(cam, { x: 0, y: 0, z });
      const midden = scherm(cam, { x: 0, y: -0.55 * L, z });
      const lengte = Math.hypot(punt.x - staart.x, punt.y - staart.y);
      const naast = { x: midden.x - 3 * (punt.y - staart.y) / lengte, y: midden.y + 3 * (punt.x - staart.x) / lengte };
      selectie = null;
      klik(naast);
      ok(!/memberLoad/.test(tekenvlakEl().dataset.openFem3dPickCandidates ?? ""), `z = ${z}: de straal raakt de pijl hier niet`);
      gelijk(selectie, { type: "memberLoad", id: 391 }, `3 px naast de pijlsteel op z = ${z}`);
    }
  });

  await test("oplegging: een klik op het opleggingsteken selecteert de knoop", async () => {
    await toon(staalhal, windZicht, { activeLoadCaseId: 3, camera: windCamera });
    const cam = camera();
    // De zijkant van het inklemmingsblok (straal 0,76 · maat, onder de knoop).
    for (const [x, y] of [[0.7, 0], [0.45, -0.45]]) {
      selectie = null;
      klik(scherm(cam, { x: x * tekenMaat, y: y * tekenMaat, z: -0.18 * tekenMaat }));
      gelijk(selectie, { type: "node", id: 1 }, `teken op (${x}, ${y}) · maat`);
      gelijk(tekenvlakEl().dataset.openFem3dPickReason, "support", "keuze");
    }
  });
}

async function kleineModellen() {
  await test("pannen met de scrollknop: het gepakte punt gaat één op één met de muis mee", async () => {
    // De camera kijkt schuin van boven; het draaipunt ligt 10 m voor de voorste
    // ligger. Pak je de achterste ligger (verder weg dan het draaipunt), dan
    // moet de pan sneller gaan dan in het vlak door het draaipunt.
    const positie = new THREE.Vector3(3, -15, 6), doel = new THREE.Vector3(3, -5, 3.5);
    await toon(tweeLiggers, { ...snel }, { camera: { position: positie.toArray(), target: doel.toArray(), up: [0, 0, 1] } });
    const cam = camera();
    const kijk = doel.clone().sub(positie).normalize();
    const diepte = (p: THREE.Vector3) => p.clone().sub(positie).dot(kijk);
    for (const [naam, punt] of [["achterste ligger", new THREE.Vector3(3, 10, 0)], ["voorste ligger", new THREE.Vector3(3, 0, 0.5)]] as const) {
      const p = scherm(cam, punt);
      wijzer("pointerdown", p, 1, 4);
      wijzer("pointerup", p, 1, 0);
      const snelheid = Number(tekenvlakEl().dataset.openFem3dPanSpeed);
      const verwacht = diepte(punt) / diepte(doel);
      ok(Math.abs(snelheid - verwacht) < 0.05 * verwacht, `${naam}: pansnelheid ${snelheid}, verwacht ${verwacht.toFixed(3)} (diepte punt / diepte draaipunt)`);
    }
  });

  await test("last: een pijl van een ligger tien meter verderop wint niet van de ligger ervoor; op de pijl zelf wel", async () => {
    await toon(tweeLiggers, { ...snel }, { camera: vooraanzicht(3, 0.5, 15) });
    const cam = camera();
    // De pijl op 25 % van de achterste ligger; de voorste ligger ligt ervoor.
    const pijl = scherm(cam, { x: 1.5, y: 10, z: 0.5 });
    const vooras = scherm(cam, { x: 1.5, y: 0, z: 0.5 });
    ok(Math.abs(pijl.y - vooras.y) < 1e-6, "opzet: de pijl ligt achter de voorste ligger");
    selectie = null;
    klik({ x: pijl.x, y: pijl.y - 3 });
    gelijk(selectie, { type: "beam", id: 1 }, "3 px boven de voorste ligger, op de pijl erachter");
    gelijk(tekenvlakEl().dataset.openFem3dPickReason, "beam-line", "keuze");
    ok(/memberLoad/.test(tekenvlakEl().dataset.openFem3dPickCandidates ?? ""), "de straal raakte de pijl wel");
    selectie = null;
    const opPijl = scherm(cam, { x: 1.5, y: 10, z: 0.8 });
    klik(opPijl);
    gelijk(selectie, { type: "memberLoad", id: 7 }, "klik op de pijl zelf, ver van de voorste ligger");
  });

  await test("randstaaf naast een plaat: 3 px naast de staaf op het plaatvlak → de staaf; midden → de plaat", async () => {
    await toon(vloer, { ...snel }, { camera: { position: [3, -6, 10], target: [3, 2, 0], up: [0, 0, 1] } });
    const cam = camera();
    const a = scherm(cam, { x: 1, y: 0, z: 0 }), b = scherm(cam, { x: 5, y: 0, z: 0 });
    const binnen = scherm(cam, { x: 3, y: 0.5, z: 0 });
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    let nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;
    const midden = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((binnen.x - midden.x) * nx + (binnen.y - midden.y) * ny < 0) { nx = -nx; ny = -ny; }
    klik({ x: midden.x + 3 * nx, y: midden.y + 3 * ny });
    gelijk(selectie, { type: "beam", id: 1 }, "3 px naast de randstaaf, op de plaat");
    klik(scherm(cam, { x: 3, y: 2, z: 0 }));
    gelijk(selectie, { type: "plate", id: 1 }, "midden van de plaat");
  });

  await test("crossing van rechts naar links: gestippeld kader, staaf die erdoor loopt; venster: doorgetrokken, niets", async () => {
    document.documentElement.setAttribute("data-oa-theme", "dark");
    try {
      await toon(portaal, { ...snel }, { camera: vooraanzicht(0.5, 3, 16) });
      const cam = camera();
      const m = scherm(cam, { x: 0, y: 0, z: 0 });
      const rechts = { x: m.x + 50, y: m.y - 30 }, links = { x: m.x - 50, y: m.y + 30 };
      wijzer("pointerdown", rechts, 0, 1);
      wijzer("pointermove", links, 0, 1);
      const kader = kaderEl();
      ok(!kader.hidden, "kader zichtbaar tijdens het slepen");
      gelijk(kader.dataset.modus, "crossing", "modus naar links");
      const stijl = getComputedStyle(kader);
      gelijk([stijl.borderTopStyle, stijl.borderTopColor], ["dashed", "rgb(22, 163, 74)"], "crossingkader (wit 3D-podium, ook in het donkere thema)");
      const crossingVulling = stijl.backgroundColor;
      wijzer("pointerup", links, 0, 0);
      gelijk(selectie, { type: "beam", id: 1 }, "crossing selecteert de ligger");
      gelijk(tekenvlakEl().dataset.openFem3dBoxSelectMode, "crossing", "diagnose");
      wijzer("pointerdown", links, 0, 1);
      wijzer("pointermove", rechts, 0, 1);
      gelijk(kaderEl().dataset.modus, "venster", "modus naar rechts");
      const venster = getComputedStyle(kaderEl());
      gelijk([venster.borderTopStyle, venster.borderTopColor], ["solid", "rgb(37, 99, 235)"], "vensterkader");
      ok(venster.backgroundColor !== crossingVulling, "andere vulling voor venster en crossing");
      wijzer("pointerup", rechts, 0, 0);
      gelijk(selectie, null, "het venster bevat de ligger niet geheel");
    } finally {
      document.documentElement.removeAttribute("data-oa-theme");
    }
  });

  await test("rechts slepen met een selectie draait om het midden daarvan; zonder selectie om het doel", async () => {
    await toon(portaal, { ...snel }, { camera: { position: [14, -18, 12], target: [0.5, 0, 3], up: [0, 0, 1] } });
    let cam = camera();
    klik(scherm(cam, { x: 6, y: 0, z: 3 }));
    gelijk(selectie, { type: "beam", id: 2 }, "kolom geselecteerd");
    const draaipunt = { x: 6, y: 0, z: 3 };
    const voor = scherm(cam, draaipunt);
    const doelVoor = tekenvlakEl().dataset.openFem3dCameraTarget;
    const start = { x: 300, y: 400 };
    wijzer("pointerdown", start, 2, 2);
    gelijk(tekenvlakEl().dataset.openFem3dOrbitPivot, "6.000000,0.000000,3.000000", "draaipunt = midden van de kolom");
    for (const [dx, dy] of [[30, 5], [70, 12], [120, -20]]) wijzer("pointermove", { x: start.x + dx, y: start.y + dy }, 2, 2);
    wijzer("pointerup", { x: start.x + 120, y: start.y - 20 }, 2, 0);
    await wacht();
    cam = camera();
    const na = scherm(cam, draaipunt);
    ok(Math.hypot(na.x - voor.x, na.y - voor.y) < 0.5, `het draaipunt verschoof ${Math.hypot(na.x - voor.x, na.y - voor.y).toFixed(3)} px`);
    ok(tekenvlakEl().dataset.openFem3dCameraTarget !== doelVoor, "het doel schoof mee");
    const positieVoorTweede = tekenvlakEl().dataset.openFem3dCameraPosition;
    toets("Escape");
    gelijk(selectie, null, "Escape in Selecteren heft de selectie op");
    const doel = tekenvlakEl().dataset.openFem3dCameraTarget;
    wijzer("pointerdown", start, 2, 2);
    gelijk(tekenvlakEl().dataset.openFem3dOrbitPivot, "none", "geen draaipunt zonder selectie");
    wijzer("pointermove", { x: start.x + 80, y: start.y }, 2, 2);
    wijzer("pointerup", { x: start.x + 80, y: start.y }, 2, 0);
    await wacht();
    gelijk(tekenvlakEl().dataset.openFem3dCameraTarget, doel, "zonder selectie blijft het doel staan");
    ok(tekenvlakEl().dataset.openFem3dCameraPosition !== positieVoorTweede, "de camera draaide wel");
  });

  await test("Escape: uit het gereedschap (selectie blijft), tweede Escape: selectie weg; niet in een invoerveld", async () => {
    await toon(portaal, { ...snel }, { camera: vooraanzicht(0.5, 3, 16) });
    klik(scherm(camera(), { x: -2, y: 0, z: 0 }));
    gelijk(selectie, { type: "beam", id: 1 }, "ligger geselecteerd");
    flushSync(() => zetGereedschap("addBeam"));
    const veld = document.createElement("input");
    document.body.appendChild(veld);
    veld.focus();
    toets("Escape", veld);
    gelijk([gereedschap, selectie], ["addBeam", { type: "beam", id: 1 }], "Escape in een invoerveld");
    veld.remove();
    toets("Escape");
    gelijk([gereedschap, selectie], ["select", { type: "beam", id: 1 }], "eerste Escape");
    await wacht();
    toets("Escape");
    gelijk([gereedschap, selectie], ["select", null], "tweede Escape");
  });

  await test("oplegging en veer: klik in leeg canvas → punt op het werkvlak; op een knoop → die knoop", async () => {
    geplaatst = [];
    await toon(portaal, { ...snel }, { camera: { position: [8, -14, 12], target: [0.5, 0, 0], up: [0, 0, 1] }, workPlaneZ: 2 });
    flushSync(() => zetGereedschap("support:pinned"));
    await wacht();
    const cam = camera();
    klik(scherm(cam, { x: -2, y: 4, z: 2 }));
    gelijk(geplaatst.at(-1), { position: { x: -2, y: 4, z: 2 } }, "leeg canvas → rasterpunt op het werkvlak z = 2 m");
    klik(scherm(cam, { x: 6, y: 0, z: 0 }));
    gelijk(geplaatst.at(-1), { nodeId: 3 }, "klik op knoop 3");
    flushSync(() => zetGereedschap("spring:kz"));
    await wacht();
    klik(scherm(cam, { x: 1, y: 3, z: 2 }));
    gelijk(geplaatst.at(-1), { position: { x: 1, y: 3, z: 2 } }, "veergereedschap: ook in leeg canvas");
    gelijk(geplaatst.length, 3, "drie plaatsingen");
    ok(tekenvlakEl().className.includes("open-fem3d-tool-support"), "kruisdraadcursor bij het veergereedschap");
  });


  await test("vervormde vorm: één doorlopend profiel per staaf, vergroting automatisch of vast, origineel als schim of weg", async () => {
    const auto = openFem3DAutoDeformationScale(vervormModel, vervormResultaat);
    await toon(vervormModel, vervormZicht, { result: vervormResultaat, camera: vervormCamera });
    const ds = () => tekenvlakEl().dataset;
    gelijk([ds().openFem3dDeformedSweeps, ds().openFem3dDeformationScale, ds().openFem3dOriginal],
      ["2", auto.toPrecision(6), "ghost"], "automatisch, origineel als schim");
    await toon(vervormModel, vervormZicht, { result: vervormResultaat, deformationDisplay: { scale: 10, showOriginal: false }, camera: vervormCamera });
    gelijk([ds().openFem3dDeformationScale, ds().openFem3dOriginal], [(10).toPrecision(6), "hidden"], "vast ×10, origineel weg");
    // Het onvervormde model is onzichtbaar maar niet weg: aanklikken blijft werken.
    klik(scherm(camera(), { x: 2, y: 0, z: 0 }));
    gelijk(selectie, { type: "beam", id: 1 }, "de onzichtbare ligger is nog aan te klikken");
    await toon(vervormModel, { ...vervormZicht, deformation: false }, { result: vervormResultaat, deformationDisplay: { scale: 10, showOriginal: false }, camera: vervormCamera });
    gelijk([ds().openFem3dDeformationScale, ds().openFem3dOriginal], ["none", "normal"], "zonder vervormde vorm: het model gewoon");
  });

  await test("verkenner Resultaten: onder Vervormde vorm de regelaar (automatisch, factor zichtbaar) en Origineel tonen", async () => {
    let weergave: OpenFem3DDeformationDisplay = { scale: "auto", showOriginal: true };
    function Verkenner() {
      const [d, setD] = useState<OpenFem3DDeformationDisplay>(weergave);
      weergave = d;
      return <div style={{ width: 280 }}><OpenFem3DExplorer model={vervormModel} selection={null} setSelection={() => {}}
        result={vervormResultaat} activeTab="results" setActiveTab={() => {}} visibility={vervormZicht} setVisibility={() => {}}
        deformationDisplay={d} setDeformationDisplay={(next) => { weergave = next; setD(next); }}
        displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} gridShow={false} setGridShow={() => {}}
        structuralGrid={DEFAULT_STRUCTURAL_GRID} setStructuralGridEnabled={() => {}} /></div>;
    }
    mount(<Verkenner />);
    await wacht();
    const factor = () => container.querySelector("[data-open-fem3d-deformation-factor]")?.textContent;
    const auto = openFem3DAutoDeformationScale(vervormModel, vervormResultaat);
    gelijk(factor(), `×${auto.toFixed(0)}`, "de actuele automatische factor");
    const autoVinkje = () => container.querySelector<HTMLInputElement>("[data-open-fem3d-deformation-auto]")!;
    ok(autoVinkje().checked, "Automatisch staat aan");
    const regelaar = container.querySelector<HTMLInputElement>("[data-open-fem3d-deformation-scale] input[type=range]")!;
    const zet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    flushSync(() => { zet.call(regelaar, "100"); regelaar.dispatchEvent(new Event("input", { bubbles: true })); });
    await wacht();
    gelijk(weergave.scale, 10, "regelaar op stand 100 → ×10");
    gelijk(factor(), "×10", "factor zichtbaar");
    ok(!autoVinkje().checked, "Automatisch uit");
    flushSync(() => autoVinkje().click());
    await wacht();
    gelijk(weergave.scale, "auto", "terug naar automatisch");
    flushSync(() => container.querySelector<HTMLInputElement>("[data-open-fem3d-show-original]")!.click());
    await wacht();
    gelijk(weergave.showOriginal, false, "Origineel tonen uit");
  });

  await test("3D-editor: Escape sluit het paneel van Verplaatsen en zet Selecteren terug; in het paneelveld niet", async () => {
    const liggerModel = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
    });
    let editorTool: OpenFem3DTool = "select";
    let editorSelectie: OpenFem3DSelection = null;
    let zetEditorTool: (tool: OpenFem3DTool) => void = () => {};
    function Editor() {
      const [sel, setSel] = useState<OpenFem3DSelection>(null);
      const [tool, setTool] = useState<OpenFem3DTool>("select");
      editorTool = tool;
      editorSelectie = sel;
      zetEditorTool = setTool;
      return <div style={{ width: BREED, height: HOOG, display: "flex" }}>
        <OpenFem3DEditor model={liggerModel} onChange={() => {}}
          tool={tool} onToolChange={setTool} selection={sel} onSelectionChange={setSel}
          visibility={editorZicht} initialCamera={{ position: [3, -9, 4], target: [3, 0, 0], up: [0, 0, 1] }} />
      </div>;
    }
    mount(<Editor />);
    await wacht(200);
    klik(scherm(camera(), { x: 3, y: 0, z: 0 }));
    await wacht();
    gelijk(editorSelectie, { type: "beam", id: 1 }, "ligger geselecteerd");
    flushSync(() => zetEditorTool("move"));
    await wacht();
    const paneel = () => container.querySelector(".open-fem3d-transform-panel");
    ok(paneel(), "het paneel Verplaatsen staat open");
    const veld = paneel()!.querySelector("input")!;
    veld.focus();
    toets("Escape", veld);
    await wacht();
    ok(paneel() && editorTool === "move", "Escape in het invoerveld van het paneel laat het paneel staan");
    veld.blur();
    toets("Escape");
    await wacht();
    gelijk([editorTool, editorSelectie, !!paneel()], ["select", { type: "beam", id: 1 }, false], "eerste Escape: paneel dicht, selectie blijft");
    toets("Escape");
    await wacht();
    gelijk(editorSelectie, null, "tweede Escape: selectie weg");
  });

  await test("3D-editor: Delete verwijdert een plaat met opening; de historie (Ctrl+Z) zet haar terug", async () => {
    const plaatModel = addOpenFem3DSurfaceLoad(addOpenFem3DPlateOpening(addOpenFem3DPlate(parseOpenFem3DModel({
      nodes: [
        { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
        { id: 5, x: 2, y: 1, z: 0 }, { id: 6, x: 4, y: 1, z: 0 }, { id: 7, x: 4, y: 3, z: 0 }, { id: 8, x: 2, y: 3, z: 0 },
      ],
      beams: [],
    }), [1, 2, 3, 4], { thicknessM: 0.2 }), 1, [5, 6, 7, 8]), 1, { qx: 0, qy: 0, qz: -2 });
    let historie = { model: plaatModel, past: [] as OpenFem3DModel[], future: [] as OpenFem3DModel[] };
    let doe: (action: Parameters<typeof openFem3dHistoryReducer>[1]) => void = () => {};
    let editorSelectie: OpenFem3DSelection = null;
    function Editor() {
      const [state, dispatch] = useReducer(openFem3dHistoryReducer, historie);
      const [sel, setSel] = useState<OpenFem3DSelection>(null);
      const [tool, setTool] = useState<OpenFem3DTool>("select");
      historie = state;
      editorSelectie = sel;
      doe = dispatch;
      return <div style={{ width: BREED, height: HOOG, display: "flex" }}>
        <OpenFem3DEditor model={state.model} onChange={(model, meta) => dispatch({ type: "edit", model, ...meta })}
          tool={tool} onToolChange={setTool} selection={sel} onSelectionChange={setSel}
          visibility={editorZicht} initialCamera={editorCamera} />
      </div>;
    }
    mount(<Editor />);
    await wacht(200);
    klik(scherm(camera(), { x: 1, y: 2, z: 0 }));
    await wacht();
    gelijk(editorSelectie, { type: "plate", id: 1 }, "plaat met één klik geselecteerd");
    const veld = document.createElement("input");
    document.body.appendChild(veld);
    veld.focus();
    toets("Delete", veld);
    veld.remove();
    await wacht();
    gelijk((historie.model.plates ?? []).length, 1, "Delete in een invoerveld verwijdert niets");
    toets("Delete");
    await wacht();
    gelijk([(historie.model.plates ?? []).length, (historie.model.surfaceLoads ?? []).length, historie.model.nodes.length],
      [0, 0, 8], "plaat met opening en oppervlaktelast weg, knopen blijven");
    gelijk(editorSelectie, null, "de selectie is leeg");
    flushSync(() => doe({ type: "undo" }));
    await wacht();
    ok(historie.model === plaatModel, "Ctrl+Z zet precies het vorige model terug");
    gelijk(historie.model.plates?.[0]?.openings?.length, 1, "met de opening");
  });
}

// ── View cube (issue #85): eigen groep, eigen browserproces ────────────────
const menuKnopEl = () => kubusEl().querySelector<HTMLButtonElement>("[data-open-fem3d-view-cube-menuknop]")!;
const menuEl = () => kubusEl().querySelector<HTMLElement>(".open-fem3d-view-cube-menu")!;
const menuItemEl = (id: string) => kubusEl().querySelector<HTMLElement>(`[data-open-fem3d-view-cube-menuitem="${id}"]`)!;
const vlakEl = (vlak: string) => kubusEl().querySelector<HTMLElement>(`.open-fem3d-view-cube-vlak[data-vlak="${vlak}"]`)!;
const middenVan = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const overlapt = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const zichtbareVlakken = () => [...kubusEl().querySelectorAll<HTMLElement>('.open-fem3d-view-cube-vlak[data-naar-kijker="ja"]')]
  .map((v) => v.dataset.vlak).sort();
const actiefEl = () => document.activeElement as HTMLElement;
/** Twee camera's (positie, doel, up uit de diagnose) op 1e-4 m gelijk. */
function cameraBijna(a: (string | undefined)[], b: (string | undefined)[], m: string) {
  const getallen = (t: (string | undefined)[]) => t.flatMap((s) => (s ?? "").split(",").map(Number));
  const x = getallen(a), y = getallen(b);
  ok(x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) < 1e-4), `${m}: ${a.join(" | ")} ≠ ${b.join(" | ")}`);
}
/**
 * Een echte klik op `el`: in het midden van zijn rechthoek, pas nadat de
 * hit-test van de browser (elementFromPoint) bevestigt dat `el` daar bovenop
 * ligt. Dan pointerdown, pointerup en click op wat de browser daar raakt.
 */
function klikEcht(el: Element, wat: string) {
  const { x, y } = middenVan(el.getBoundingClientRect());
  const raak = document.elementFromPoint(x, y);
  ok(raak !== null && (raak === el || el.contains(raak)),
    `${wat} ligt niet bovenop in (${x.toFixed(0)}, ${y.toFixed(0)}); geraakt: ${(raak as HTMLElement | null)?.className || raak?.nodeName}`);
  const init = { clientX: x, clientY: y, button: 0, pointerId: 11, pointerType: "mouse", bubbles: true, cancelable: true, composed: true };
  flushSync(() => {
    raak!.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
    raak!.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    raak!.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 }));
  });
}
/** Een wijzer-event op het canvas (in clientcoördinaten), met de pointerId van de kubusproeven. */
function canvasWijzer(type: string, x: number, y: number, knoppen: number) {
  flushSync(() => {
    canvasEl().dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, button: 0, buttons: knoppen, pointerId: 7, pointerType: "mouse", bubbles: true, cancelable: true,
    }));
  });
}
/** Relatieve luminantie (WCAG 2) van "rgb(…)"/"rgba(…)", over `onder` gemengd als er alfa is. */
function rgb(tekst: string): [number, number, number, number] {
  const m = /rgba?\(([^)]+)\)/.exec(tekst);
  if (!m) throw Error(`geen kleur: ${tekst}`);
  const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [r, g, b, a];
}
const meng = (boven: [number, number, number, number], onder: [number, number, number, number]): [number, number, number, number] =>
  [0, 1, 2].map((i) => boven[i] * boven[3] + onder[i] * (1 - boven[3])).concat(1) as [number, number, number, number];
const luminantie = ([r, g, b]: number[]) => {
  const k = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
};
const contrast = (a: number[], b: number[]) => {
  const [l1, l2] = [luminantie(a), luminantie(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
/** De samengestelde CSS-matrix van `el` tot en met de scène van de kubus (alleen richtingen). */
function schermMatrix(el: HTMLElement): DOMMatrix {
  let m = new DOMMatrix();
  for (let huidig: HTMLElement | null = el; huidig && !huidig.classList.contains("open-fem3d-view-cube-kubus"); huidig = huidig.parentElement) {
    const t = getComputedStyle(huidig).transform;
    if (t && t !== "none") m = new DOMMatrix(t).multiply(m);
  }
  return m;
}
const schermRichting = (m: DOMMatrix, x: number, y: number) => {
  const p = m.transformPoint(new DOMPoint(x, y, 0, 0));
  const l = Math.hypot(p.x, p.y);
  return { x: p.x / l, y: p.y / l };
};

// De 3D-editor met de bediening van de app: Passend beeld (knop en lint),
// aanzicht melden zoals App.tsx (zelfde token), werkvlak, Views, panelen.
let editorStuur: {
  zicht: (v: OpenFem3DVisibility) => void; tool: (t: OpenFem3DTool) => void; selectie: (s: OpenFem3DSelection) => void;
  fit: () => void; camera: (c: OpenFem3DCameraState) => void;
} = { zicht: () => {}, tool: () => {}, selectie: () => {}, fit: () => {}, camera: () => {} };
let editorAanzicht: OpenFem3DView = "iso";
/** De zichtbaarheid van de editor zoals die nu is (o.a. perspective na het menu-item Perspectief). */
let editorZichtNu: OpenFem3DVisibility | null = null;
/** Model, selectie en gereedschap van de editor zoals ze nu zijn. */
let editorModelNu: OpenFem3DModel | null = null;
let editorSelectieNu: OpenFem3DSelection = null;
let editorToolNu: OpenFem3DTool = "select";
function KubusEditor({ begin, zicht: beginZicht, camera: beginCamera, hoog = HOOG, breed = BREED }: {
  begin: OpenFem3DModel; zicht: OpenFem3DVisibility; camera?: OpenFem3DCameraState; hoog?: number; breed?: number;
}) {
  const [model, setModel] = useState(begin);
  const [zicht, setZicht] = useState(beginZicht);
  const [tool, setTool] = useState<OpenFem3DTool>("select");
  const [sel, setSel] = useState<OpenFem3DSelection>(null);
  const [viewRequest, setViewRequest] = useState<{ kind: OpenFem3DView; token: number }>({ kind: "iso", token: 0 });
  const [fitRequest, setFitRequest] = useState(0);
  const [cameraVerzoek, setCameraVerzoek] = useState<{ state: OpenFem3DCameraState; token: number } | undefined>(undefined);
  editorStuur = {
    zicht: setZicht, tool: setTool, selectie: setSel, fit: () => setFitRequest((n) => n + 1),
    camera: (state) => setCameraVerzoek((vorig) => ({ state, token: (vorig?.token ?? 0) + 1 })),
  };
  editorAanzicht = viewRequest.kind;
  editorZichtNu = zicht;
  editorModelNu = model;
  editorSelectieNu = sel;
  editorToolNu = tool;
  return <div style={{ width: breed, height: hoog, display: "flex" }}>
    <OpenFem3DEditor model={model} onChange={(next) => setModel(next)} tool={tool} onToolChange={setTool}
      selection={sel} onSelectionChange={setSel} visibility={zicht} onVisibilityChange={setZicht}
      viewRequest={viewRequest} fitRequest={fitRequest} initialCamera={beginCamera ?? null}
      onCameraViewChange={(kind) => setViewRequest((vorig) => (vorig.kind === kind ? vorig : { ...vorig, kind }))}
      onCameraStateChange={(state) => { cameraOpgeslagen = state; }} cameraVerzoek={cameraVerzoek} />
  </div>;
}
async function toonEditor(begin: OpenFem3DModel, zicht: OpenFem3DVisibility, extra: {
  camera?: OpenFem3DCameraState; hoog?: number; breed?: number;
} = {}) {
  cameraOpgeslagen = null;
  mount(<KubusEditor begin={begin} zicht={zicht} {...extra} />);
  await wacht(250);
}
const schuin = { position: [14, -18, 12] as [number, number, number], target: [0.5, 0, 3] as [number, number, number], up: [0, 0, 1] as [number, number, number] };
/** Een camera vanuit richting `r` (van het doel naar de camera) om het midden van het portaal. */
const vanuit = (r: number[], up: [number, number, number] = [0, 0, 1]): OpenFem3DCameraState => {
  const v = new THREE.Vector3(...r).normalize().multiplyScalar(22);
  return { position: [0.5 + v.x, v.y, 3 + v.z], target: [0.5, 0, 3], up };
};

async function kubusProeven() {
  await test("view cube: Dak, Voor en Rechts geven exact de camera van de lintknoppen Boven, Voor en Zij", async () => {
    for (const [id, view, richting, up] of [
      ["+z", "top", [0, 0, 1], "0.000000,1.000000,0.000000"],
      ["-y", "front", [0, -1, 0], "0.000000,0.000000,1.000000"],
      ["+x", "side", [1, 0, 0], "0.000000,0.000000,1.000000"],
    ] as const) {
      await toon(portaal, { ...snel }, { viewRequest: { kind: view, token: 1 } });
      const lint = cameraTekst();
      // Een schuine camera waarin dak, Voor en Rechts alle drie in beeld zijn.
      await toon(portaal, { ...snel }, { camera: schuin });
      cameraOpgeslagen = null;
      gemeldAanzicht = null;
      // 1 px bewegen tussen indrukken en loslaten is nog een klik.
      kubusKlik(id, 1);
      richtingIs(richting, `vlak ${id}`);
      gelijk(tekenvlakEl().dataset.openFem3dCameraUp, up, `up na ${id}`);
      gelijk(cameraTekst(), lint, `vlak ${id} = lintknop ${view}`);
      gelijk(gemeldAanzicht, view, "aanzicht gemeld");
      ok(cameraOpgeslagen !== null, "camera opgeslagen");
      gelijk(tekenvlakEl().dataset.openFem3dLabelsSuspended, "false", "labels weer zichtbaar");
      gelijk(selectie, null, "niets geselecteerd");
      // De kubus volgt: het aangeklikte vlak ligt nu midden op de kubus.
      const vak = kubusEl().getBoundingClientRect();
      const midden = document.elementFromPoint(vak.left + vak.width / 2, vak.top + vak.height / 2) as HTMLElement | null;
      gelijk(midden?.dataset.openFem3dViewCubeDoel, id, "het vlak wijst naar de kijker");
    }
  });

  await test("view cube: een hoek en een ribbe zetten de camera langs de genormaliseerde som van de normalen", async () => {
    await toon(portaal, { ...snel }, { camera: schuin });
    kubusKlik("+x-y+z");
    richtingIs([1, -1, 1], "hoek Rechts-Voor-Dak");
    gelijk(tekenvlakEl().dataset.openFem3dCameraUp, "0.000000,0.000000,1.000000", "Z omhoog");
    gelijk(tekenvlakEl().dataset.openFem3dViewCubeDoel, "+x-y+z", "diagnose");
    gelijk(gemeldAanzicht, "iso", "een hoek is een schuin aanzicht");
    kubusKlik("-y+z");
    richtingIs([0, -1, 1], "ribbe Voor-Dak");
    kubusKlik("-x-y");
    richtingIs([-1, -1, 0], "ribbe Voor-Links");
    // Doel = het midden van het model (de knopen van -5..6 × 0 × 0..6).
    gelijk(tekenvlakEl().dataset.openFem3dCameraTarget?.split(",").map((v) => Number(v).toFixed(3)),
      ["0.500", "0.000", "3.000"], "doel in het midden van het model");
    gelijk(selectie, null, "niets geselecteerd");
  });

  await test("view cube: slepen draait de camera om het doel (azimut om Z, elevatie begrensd); labels weg tijdens slepen", async () => {
    await toon(portaal, { ...snel }, { camera: schuin });
    const doel = tekenvlakEl().dataset.openFem3dCameraTarget;
    const voor = cameraOffset();
    cameraOpgeslagen = null;
    const p = kubusPunt("-y");
    kubusWijzer("pointerdown", p.el, p.x, p.y, 0, 1);
    for (const dx of [10, 25, 40]) kubusWijzer("pointermove", p.el, p.x + dx, p.y, 0, 1);
    await wacht();
    gelijk(tekenvlakEl().dataset.openFem3dLabelsSuspended, "true", "labels verborgen tijdens slepen");
    ok(cameraOpgeslagen === null, "tijdens slepen nog niet opgeslagen");
    kubusWijzer("pointerup", p.el, p.x + 40, p.y, 0, 0);
    await wacht();
    gelijk(tekenvlakEl().dataset.openFem3dLabelsSuspended, "false", "labels terug na loslaten");
    ok(cameraOpgeslagen !== null, "na loslaten opgeslagen");
    gelijk(tekenvlakEl().dataset.openFem3dCameraTarget, doel, "het doel blijft staan");
    const na = cameraOffset();
    const azimut = (v: THREE.Vector3) => Math.atan2(v.y, v.x);
    const verwacht = -2 * Math.PI * 40 / HOOG;
    ok(Math.abs(azimut(na) - azimut(voor) - verwacht) < 1e-4, `azimut ${(azimut(na) - azimut(voor)).toFixed(5)} ≠ ${verwacht.toFixed(5)} (2π · 40 px / ${HOOG} px, naar rechts)`);
    ok(Math.abs(na.z - voor.z) < 1e-5 && Math.abs(na.length() - voor.length()) < 1e-5, "zelfde hoogte en afstand bij horizontaal slepen");
    gelijk(selectie, null, "slepen selecteert niets");
    // Omlaag slepen brengt de camera hoger, maar nooit over de pool.
    const q = kubusPunt("+z");
    kubusWijzer("pointerdown", q.el, q.x, q.y, 0, 1);
    for (const dy of [20, 200, 600]) kubusWijzer("pointermove", q.el, q.x, q.y + dy, 0, 1);
    kubusWijzer("pointerup", q.el, q.x, q.y + 600, 0, 0);
    await wacht();
    const hoog = cameraOffset();
    const elevatie = Math.atan2(hoog.z, Math.hypot(hoog.x, hoog.y));
    ok(elevatie > Math.PI / 2 - 0.01 && elevatie < Math.PI / 2, `elevatie ${(elevatie * 180 / Math.PI).toFixed(3)}° (begrensd net onder 90°)`);
    gelijk(tekenvlakEl().dataset.openFem3dCameraUp, "0.000000,0.000000,1.000000", "Z blijft omhoog");
    gelijk(gemeldAanzicht, "top", "bijna recht van boven heet bovenaanzicht");
  });

  await test("view cube: slepen dat op de kubus begint en erbuiten eindigt, draait door en stopt netjes", async () => {
    await toon(portaal, { ...snel }, { camera: schuin });
    const voor = cameraOffset();
    cameraOpgeslagen = null;
    gemeldAanzicht = null;
    const vak = kubusEl().getBoundingClientRect();
    const p = kubusPunt("+z");
    kubusWijzer("pointerdown", p.el, p.x, p.y, 0, 1);
    // Zonder pointer capture (de proef vervangt die door een lege functie)
    // komen de bewegingen bij het canvas binnen, buiten de kubus.
    for (const dx of [-20, -90, -200]) canvasWijzer("pointermove", p.x + dx, p.y + 30, 1);
    ok(p.x - 200 < vak.left && p.y + 30 < vak.bottom, "de muis staat links naast de kubus");
    ok(document.elementFromPoint(p.x - 200, p.y + 30) === canvasEl(), "en daar ligt het canvas");
    gelijk(tekenvlakEl().dataset.openFem3dLabelsSuspended, "true", "slepen loopt door buiten de kubus");
    canvasWijzer("pointerup", p.x - 200, p.y + 30, 0);
    await wacht();
    gelijk(tekenvlakEl().dataset.openFem3dLabelsSuspended, "false", "losgelaten buiten de kubus: labels terug");
    ok(kubusEl().dataset.sleept === undefined, "het slepen is afgesloten");
    ok(cameraOpgeslagen !== null && gemeldAanzicht !== null, "camera opgeslagen en aanzicht gemeld");
    const na = cameraOffset();
    const azimut = (v: THREE.Vector3) => Math.atan2(v.y, v.x);
    const verwacht = 2 * Math.PI * 200 / HOOG;
    ok(Math.abs(azimut(na) - azimut(voor) - verwacht) < 1e-4, `azimut ${(azimut(na) - azimut(voor)).toFixed(5)} ≠ ${verwacht.toFixed(5)} (200 px naar links)`);
    gelijk([selectie, kaderEl().hidden], [null, true], "geen selectie en geen selectiekader van het canvas");
    // Daarna draait verder bewegen (zonder knop) niets meer.
    const camera0 = cameraTekst();
    canvasWijzer("pointermove", p.x - 260, p.y + 60, 0);
    canvasWijzer("pointermove", p.x - 300, p.y + 90, 0);
    gelijk(cameraTekst(), camera0, "na het loslaten draait niets meer");
    // Ook een afgebroken aanwijzer (pointercancel) buiten de kubus sluit af, zonder klik.
    const q = kubusPunt("+z");
    kubusWijzer("pointerdown", q.el, q.x, q.y, 0, 1);
    canvasWijzer("pointermove", q.x - 60, q.y, 1);
    canvasWijzer("pointercancel", q.x - 60, q.y, 0);
    await wacht();
    gelijk([tekenvlakEl().dataset.openFem3dLabelsSuspended, kubusEl().dataset.sleept], ["false", undefined], "afgebroken: afgesloten");
  });

  await test("view cube: een klik op de kubus selecteert niets, ook niet de ligger die eronder ligt", async () => {
    // Zoek het wereldpunt achter het midden van de kubus (vooraanzicht) en leg
    // daar een ligger doorheen.
    const camera0 = vooraanzicht(0.5, 3, 16);
    await toon(portaal, { ...snel }, { camera: camera0 });
    const vak = kubusEl().getBoundingClientRect(), doek = canvasEl().getBoundingClientRect();
    const midden = { x: vak.left + vak.width / 2 - doek.left, y: vak.top + vak.height / 2 - doek.top };
    const straal = new THREE.Raycaster();
    straal.setFromCamera(new THREE.Vector2(midden.x / BREED * 2 - 1, 1 - midden.y / HOOG * 2), camera());
    const punt = straal.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())!;
    const ligger = parseOpenFem3DModel({
      nodes: [{ id: 1, x: punt.x - 12, y: 0, z: punt.z }, { id: 2, x: punt.x + 12, y: 0, z: punt.z }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
    });
    // Opzet: zonder kubus selecteert een klik op dit punt de ligger.
    await toon(ligger, { ...snel, viewCube: false }, { camera: camera0 });
    klik(midden);
    gelijk(selectie, { type: "beam", id: 1 }, "opzet: de ligger ligt onder het midden van de kubus");
    await toon(ligger, { ...snel }, { camera: camera0 });
    const raak = document.elementFromPoint(vak.left + vak.width / 2, vak.top + vak.height / 2) as HTMLElement | null;
    ok(raak?.closest(".open-fem3d-view-cube"), `de kubus vangt de klik af (geraakt: ${raak?.className})`);
    kubusWijzer("pointerdown", raak!, vak.left + vak.width / 2, vak.top + vak.height / 2, 0, 1);
    kubusWijzer("pointerup", raak!, vak.left + vak.width / 2, vak.top + vak.height / 2, 0, 0);
    gelijk(selectie, null, "geen selectie door een klik op de kubus");
    gelijk(tekenvlakEl().dataset.openFem3dViewCubeDoel, "-y", "de klik ging naar het vlak Voor");
    // Naast de kubus (in zijn vak, maar buiten de kubus zelf) gaat de klik naar het tekenvlak.
    const hoekVak = document.elementFromPoint(vak.left + 3, vak.top + 3);
    ok(hoekVak === canvasEl(), `de lege hoek van het kubusvak blokkeert niets (geraakt: ${(hoekVak as HTMLElement | null)?.className})`);
  });

  await test("view cube: schermposities — Voor midden in vooraanzicht, Rechts rechts na een kleine draai, hoeken en ribben op hun plek (niet gespiegeld)", async () => {
    await toon(portaal, { ...snel }, { viewRequest: { kind: "front", token: 1 } });
    const vak = kubusEl().getBoundingClientRect();
    const c = middenVan(vak);
    const voor = middenVan(vlakEl("voor").getBoundingClientRect());
    ok(Math.hypot(voor.x - c.x, voor.y - c.y) < 1, `vooraanzicht: het midden van Voor (${voor.x.toFixed(1)}, ${voor.y.toFixed(1)}) ligt in het midden van de kubus (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`);
    gelijk(zichtbareVlakken(), ["voor"], "alleen Voor naar de kijker");
    const cel = (vlak: string, id: string) => middenVan(vlakEl(vlak).querySelector<HTMLElement>(`[data-open-fem3d-view-cube-doel="${id}"]`)!.getBoundingClientRect());
    const teken = (d: number) => (Math.abs(d) < 1 ? 0 : Math.sign(d));
    for (const [id, sx, sy, wat] of [
      ["+x-y+z", 1, -1, "hoek Voor-Rechts-Dak rechtsboven"], ["-x-y+z", -1, -1, "hoek Voor-Links-Dak linksboven"],
      ["+x-y-z", 1, 1, "hoek Voor-Rechts-Vloer rechtsonder"], ["-x-y-z", -1, 1, "hoek Voor-Links-Vloer linksonder"],
      ["-y+z", 0, -1, "ribbe Voor-Dak boven"], ["-y-z", 0, 1, "ribbe Voor-Vloer onder"],
      ["+x-y", 1, 0, "ribbe Voor-Rechts rechts"], ["-x-y", -1, 0, "ribbe Voor-Links links"],
    ] as const) {
      const p = cel("voor", id);
      gelijk([teken(p.x - c.x), teken(p.y - c.y)], [sx, sy], wat);
    }
    // Een kleine draai naar rechts om het model (camera naar +X): 30 px naar links slepen.
    let p = kubusPunt("-y");
    kubusWijzer("pointerdown", p.el, p.x, p.y, 0, 1);
    kubusWijzer("pointermove", p.el, p.x - 15, p.y, 0, 1);
    kubusWijzer("pointermove", p.el, p.x - 30, p.y, 0, 1);
    kubusWijzer("pointerup", p.el, p.x - 30, p.y, 0, 0);
    await wacht();
    gelijk(zichtbareVlakken(), ["rechts", "voor"], "nu ook Rechts naar de kijker");
    const rechts = middenVan(vlakEl("rechts").getBoundingClientRect());
    const voor2 = middenVan(vlakEl("voor").getBoundingClientRect());
    ok(rechts.x > c.x + 10 && voor2.x < c.x, `Rechts (${rechts.x.toFixed(1)}) rechts van het midden (${c.x.toFixed(1)}), Voor (${voor2.x.toFixed(1)}) links ervan`);
    ok(Math.abs(rechts.y - c.y) < 1 && Math.abs(voor2.y - c.y) < 1, "op dezelfde hoogte (Z omhoog)");
    const ribbe = cel("voor", "+x-y");
    ok(ribbe.x > voor2.x && ribbe.x < rechts.x, "de ribbe Voor-Rechts ligt tussen Voor en Rechts");
    // En de andere kant op: Links verschijnt links.
    await toon(portaal, { ...snel }, { viewRequest: { kind: "front", token: 1 } });
    p = kubusPunt("-y");
    kubusWijzer("pointerdown", p.el, p.x, p.y, 0, 1);
    kubusWijzer("pointermove", p.el, p.x + 15, p.y, 0, 1);
    kubusWijzer("pointermove", p.el, p.x + 30, p.y, 0, 1);
    kubusWijzer("pointerup", p.el, p.x + 30, p.y, 0, 0);
    await wacht();
    gelijk(zichtbareVlakken(), ["links", "voor"], "naar rechts slepen: Links naar de kijker");
    ok(middenVan(vlakEl("links").getBoundingClientRect()).x < c.x - 10, "Links links van het midden");
    // Bovenaanzicht (Y omhoog): Achter boven, Rechts rechts op het dak.
    await toon(portaal, { ...snel }, { viewRequest: { kind: "top", token: 1 } });
    const dak = middenVan(vlakEl("boven").getBoundingClientRect());
    ok(Math.hypot(dak.x - c.x, dak.y - c.y) < 1, "bovenaanzicht: het dak in het midden");
    for (const [id, sx, sy, wat] of [
      ["+x+y+z", 1, -1, "hoek Achter-Rechts rechtsboven"], ["-x-y+z", -1, 1, "hoek Voor-Links linksonder"],
      ["+y+z", 0, -1, "ribbe Achter boven"], ["+x+z", 1, 0, "ribbe Rechts rechts"],
    ] as const) {
      const q = cel("boven", id);
      gelijk([teken(q.x - c.x), teken(q.y - c.y)], [sx, sy], wat);
    }
  });

  await test("view cube: Startaanzicht vanaf Voor-Rechts — Voor, Rechts en het dak in beeld; de namen op dak en vloer lezen rechtop", async () => {
    await toon(portaal, { ...snel });
    richtingIs([1.4, -1.4, 1], "het eerste beeld is iso vanaf Voor-Rechts");
    gelijk(zichtbareVlakken(), ["boven", "rechts", "voor"], "Voor, Rechts en het dak naar de kijker");
    const c = middenVan(kubusEl().getBoundingClientRect());
    const [dak, voor, rechts] = ["boven", "voor", "rechts"].map((v) => middenVan(vlakEl(v).getBoundingClientRect()));
    ok(voor.x < c.x && rechts.x > c.x, "Voor links, Rechts rechts van het midden");
    ok(dak.y < voor.y && dak.y < rechts.y, "het dak erboven");
    // Leesrichting en letter-omhoog van een naam op het scherm, uit de echte
    // CSS-transformaties (scène × vlak × naam). Dak en vloer: precies
    // horizontaal; een gevel ligt schuin, maar leest van links naar rechts
    // met de letters recht omhoog (Z).
    const leest = (vlak: string, wat: string, horizontaal: boolean) => {
      const naam = vlakEl(vlak).querySelector<HTMLElement>(".open-fem3d-view-cube-naam")!;
      const m = schermMatrix(naam);
      const rechtsOp = schermRichting(m, 1, 0), letterOp = schermRichting(m, 0, -1);
      ok(horizontaal ? rechtsOp.x > 0.999 && Math.abs(rechtsOp.y) < 0.02 : rechtsOp.x > 0.5,
        `${wat}: de naam leest ${horizontaal ? "horizontaal " : ""}van links naar rechts (${rechtsOp.x.toFixed(3)}, ${rechtsOp.y.toFixed(3)})`);
      ok(letterOp.y < -0.999 && Math.abs(letterOp.x) < 0.02, `${wat}: de letters staan rechtop (${letterOp.x.toFixed(3)}, ${letterOp.y.toFixed(3)})`);
    };
    leest("boven", "dak in het startaanzicht", true);
    leest("voor", "Voor", false);
    leest("rechts", "Rechts", false);
    // De vloer met dezelfde camera gespiegeld onder het model.
    await toon(portaal, { ...snel }, { camera: vanuit([1.4, -1.4, -1]) });
    gelijk(zichtbareVlakken(), ["onder", "rechts", "voor"], "van onderen: Voor, Rechts en de vloer");
    leest("onder", "vloer van onderen", true);
  });

  await test("view cube: knop ▾ met menu (rollen); Startaanzicht = iso met passend beeld; echte klikken met hit-test; geen Home-knop meer", async () => {
    await toon(portaal, { ...snel });
    const iso = cameraTekst();
    kubusKlik("+z");
    richtingIs([0, 0, 1], "eerst van boven");
    gemeldAanzicht = null;
    ok(!kubusEl().querySelector("[data-open-fem3d-view-cube-home]"), "de losse Home-knop is weg");
    gelijk(kubusEl().querySelectorAll("button").length, 1, "één knop: ▾");
    const knop = menuKnopEl();
    gelijk([knop.getAttribute("aria-haspopup"), knop.getAttribute("aria-expanded"), knop.getAttribute("aria-label"), knop.getAttribute("aria-controls")],
      ["menu", "false", "Aanzichtopties", menuEl().id], "knop ▾");
    ok(menuEl().hidden, "menu dicht");
    const kubusVak = kubusEl().getBoundingClientRect(), knopVak = knop.getBoundingClientRect();
    ok(knopVak.right <= kubusVak.right + 0.5 && knopVak.bottom <= kubusVak.bottom + 0.5 && knopVak.left > kubusVak.left + kubusVak.width / 2
      && knopVak.top > kubusVak.top + kubusVak.height / 2, "de knop zit rechtsonder aan de kubus");
    klikEcht(knop, "knop ▾");
    gelijk(knop.getAttribute("aria-expanded"), "true", "open na een klik");
    ok(!menuEl().hidden, "menu open");
    gelijk([menuEl().getAttribute("role"), menuEl().getAttribute("aria-labelledby")], ["menu", knop.id], "menu");
    // Sinds issue #86 daaronder de section box: een schakelaar, passend op selectie en resetten.
    gelijk([...menuEl().children].map((el) => [el.getAttribute("role"), el.textContent]),
      [["menuitem", "Startaanzicht"], ["menuitem", "Passend beeld"], ["menuitemcheckbox", "Perspectief"],
        ["menuitemcheckbox", "Exploderen"], ["menuitemcheckbox", "Section box"], ["menuitem", "Section box passend op selectie"], ["menuitem", "Section box resetten"]],
      "zeven regels (Perspectief, Exploderen en Section box als schakelaar), geen plekhouders");
    gelijk(actiefEl(), menuItemEl("start"), "de focus staat op de eerste regel");
    klikEcht(menuItemEl("start"), "Startaanzicht");
    ok(menuEl().hidden && knop.getAttribute("aria-expanded") === "false", "een keuze sluit het menu");
    gelijk(actiefEl(), knop, "de focus terug op de knop");
    richtingIs([1.4, -1.4, 1], "Startaanzicht");
    gelijk(cameraTekst(), iso, "dezelfde camera als het eerste beeld (iso met passend beeld)");
    gelijk(gemeldAanzicht, "iso", "aanzicht iso gemeld");
    gelijk(selectie, null, "niets geselecteerd");
    // Opnieuw klikken op de knop sluit het open menu.
    klikEcht(knop, "knop ▾");
    klikEcht(knop, "knop ▾ (dicht)");
    ok(menuEl().hidden, "tweede klik sluit");
    // Klik buiten het menu (op het canvas) sluit het.
    klikEcht(knop, "knop ▾");
    canvasWijzer("pointerdown", canvasEl().getBoundingClientRect().left + 200, canvasEl().getBoundingClientRect().top + 400, 1);
    canvasWijzer("pointerup", canvasEl().getBoundingClientRect().left + 200, canvasEl().getBoundingClientRect().top + 400, 0);
    ok(menuEl().hidden, "klik buiten het menu sluit");
  });

  await test("view cube: menu ▾ met het toetsenbord (Enter, spatie, pijl omlaag; pijltjes; Escape terug naar de knop; Tab sluit)", async () => {
    await toon(portaal, { ...snel }, { camera: schuin });
    delete tekenvlakEl().dataset.openFem3dEscape;
    const knop = menuKnopEl();
    knop.focus();
    for (const toetsNaam of ["Enter", " ", "ArrowDown"]) {
      toets(toetsNaam, knop);
      ok(!menuEl().hidden, `${JSON.stringify(toetsNaam)} opent`);
      gelijk(actiefEl(), menuItemEl("start"), `${JSON.stringify(toetsNaam)}: focus op de eerste regel`);
      toets("ArrowDown", actiefEl());
      gelijk(actiefEl(), menuItemEl("passend"), "pijl omlaag: volgende regel");
      toets("ArrowDown", actiefEl());
      gelijk(actiefEl(), menuItemEl("perspectief"), "pijl omlaag: de schakelaar Perspectief");
      // Daaronder de section box (issue #86): de schakelaar, passend op
      // selectie (zonder selectie uitgeschakeld, wel bereikbaar) en Reset.
      for (const regel of ["sectionBox", "sectionBoxSelectie", "sectionBoxReset"]) {
        toets("ArrowDown", actiefEl());
        gelijk(actiefEl(), menuItemEl(regel), `pijl omlaag: ${regel}`);
      }
      toets("ArrowDown", actiefEl());
      gelijk(actiefEl(), menuItemEl("start"), "pijl omlaag rondom");
      toets("ArrowUp", actiefEl());
      gelijk(actiefEl(), menuItemEl("sectionBoxReset"), "pijl omhoog rondom");
      toets("Home", actiefEl());
      gelijk(actiefEl(), menuItemEl("start"), "Home");
      toets("End", actiefEl());
      gelijk(actiefEl(), menuItemEl("sectionBoxReset"), "End");
      toets("Escape", actiefEl());
      ok(menuEl().hidden, "Escape sluit");
      gelijk(actiefEl(), knop, "Escape: de focus terug op de knop");
    }
    gelijk(tekenvlakEl().dataset.openFem3dEscape, undefined, "Escape in het menu raakt het tekenvlak niet (gereedschap, selectie)");
    toets("ArrowUp", knop);
    gelijk(actiefEl(), menuItemEl("sectionBoxReset"), "pijl omhoog op de knop: de laatste regel");
    toets("Tab", actiefEl());
    ok(menuEl().hidden, "Tab sluit");
    // Enter op een regel kiest hem: Startaanzicht.
    knop.focus();
    toets("Enter", knop);
    toets("Enter", actiefEl());
    ok(menuEl().hidden, "Enter op een regel kiest en sluit");
    gelijk(actiefEl(), knop, "focus terug op de knop");
    richtingIs([1.4, -1.4, 1], "Enter op Startaanzicht");
  });

  await test("view cube: Passend beeld na Achter, Links, Onder, een ribbe en een hoek behoudt kijkrichting en up (knop, lint en menu gelijk)", async () => {
    await toonEditor(portaal, { ...snel }, { camera: vanuit([-1, 1, 1]) });
    for (const [id, vanaf, richting, up, gemeld] of [
      ["+y", [-1, 1, 1], [0, 1, 0], "0.000000,0.000000,1.000000", "front"],
      ["-x", [-1, 1, 1], [-1, 0, 0], "0.000000,0.000000,1.000000", "side"],
      ["-z", [-1, 1, -1], [0, 0, -1], "0.000000,1.000000,0.000000", "top"],
      ["-x+y", [-1, 1, 1], [-1, 1, 0], "0.000000,0.000000,1.000000", "iso"],
      ["-x+y+z", [-1, 1, 1], [-1, 1, 1], "0.000000,0.000000,1.000000", "iso"],
    ] as const) {
      flushSync(() => editorStuur.camera(vanuit(vanaf)));
      await wacht();
      kubusKlik(id);
      await wacht();
      richtingIs(richting, `klik op ${id}`);
      gelijk(editorAanzicht, gemeld, `${id}: het gemelde aanzicht (een benadering, geen richting)`);
      const na = cameraTekst();
      klikEcht(container.querySelector(".open-fem3d-fit")!, "knop Passend beeld");
      await wacht();
      richtingIs(richting, `Passend beeld (knop) na ${id}`);
      gelijk(tekenvlakEl().dataset.openFem3dCameraUp, up, `up na Passend beeld (${id})`);
      cameraBijna(cameraTekst(), na, `${id}: de kubusklik gaf al een passend beeld; Passend beeld verandert (bijna) niets`);
      flushSync(() => editorStuur.fit());
      await wacht();
      richtingIs(richting, `Passend beeld uit het lint (fitRequest) na ${id}`);
      cameraBijna(cameraTekst(), na, `${id}: Passend beeld uit het lint idem`);
    }
    // Ver weg en opzij geschoven: knop en menu geven precies hetzelfde passend beeld.
    const ver: OpenFem3DCameraState = { position: [-60, 70, 50], target: [9, 4, -3], up: [0, 0, 1] };
    flushSync(() => editorStuur.camera(ver));
    await wacht();
    klikEcht(container.querySelector(".open-fem3d-fit")!, "knop Passend beeld");
    await wacht();
    const knopBeeld = cameraTekst();
    richtingIs([-69, 66, 53], "de knop behoudt de richting van de verre camera");
    flushSync(() => editorStuur.camera(ver));
    await wacht();
    klikEcht(menuKnopEl(), "knop ▾");
    klikEcht(menuItemEl("passend"), "menu Passend beeld");
    await wacht();
    gelijk(cameraTekst(), knopBeeld, "menu Passend beeld = de knop Passend beeld");
  });

  await test("view cube: geen deel van kubus, maaiveld, knop ▾ of menu ligt over Views, Passend beeld of het werkvlak (vier talen, 1000 en 760 px breed, ook gedraaid)", async () => {
    // Op 760 px loopt de uitleg in de kopregel over meer regels.
    try {
      for (const [taal, breed] of ["nl", "en", "de", "fr"].flatMap((t) => [[t, BREED], [t, 760]] as const)) {
        await i18next.changeLanguage(taal);
        await toonEditor(portaal, { ...snel }, { breed });
        const stage = container.querySelector<HTMLElement>(".open-fem3d-stage")!;
        const knoppen = [".open-fem3d-views-button", ".open-fem3d-fit", ".open-fem3d-workplane"]
          .map((q) => [q, stage.querySelector<HTMLElement>(q)!] as const);
        const delen = () => [
          ...[...kubusEl().querySelectorAll<HTMLElement>(".open-fem3d-view-cube-vlak, .open-fem3d-view-cube-maaiveld")],
          menuKnopEl(), ...(menuEl().hidden ? [] : [menuEl()]),
        ];
        const proef = (stand: string) => {
          for (const [q, knop] of knoppen) {
            const r = knop.getBoundingClientRect();
            for (const deel of delen()) {
              ok(!overlapt(deel.getBoundingClientRect(), r), `${taal} ${breed} px, ${stand}: ${deel.className} ligt over ${q}`);
            }
            for (const [x, y] of [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]]) {
              const raak = document.elementFromPoint(x, y);
              ok(raak !== null && knop.contains(raak), `${taal} ${breed} px, ${stand}: ${q} niet bovenop in (${x.toFixed(0)}, ${y.toFixed(0)}); geraakt: ${(raak as HTMLElement | null)?.className}`);
            }
          }
        };
        proef("startaanzicht");
        klikEcht(menuKnopEl(), "knop ▾");
        proef("menu open");
        toets("Escape", actiefEl());
        for (const id of ["+x-y+z", "+z", "-y+z", "-y"]) {
          kubusKlik(id);
          await wacht();
          proef(`na ${id}`);
        }
        const p = kubusPunt("-y");
        kubusWijzer("pointerdown", p.el, p.x, p.y, 0, 1);
        for (const dy of [-60, -150, -250]) kubusWijzer("pointermove", p.el, p.x + 33, p.y + dy, 0, 1);
        kubusWijzer("pointerup", p.el, p.x + 33, p.y - 250, 0, 0);
        await wacht();
        ok(cameraOffset().z < 0, "opzet: de camera staat nu onder het doel");
        proef("van onderen gesleept");
      }
    } finally {
      await i18next.changeLanguage("nl");
    }
  });

  await test("view cube: toetsenbordfocus alleen op doelen die naar de kijker wijzen, ook na draaien", async () => {
    await toon(portaal, { ...snel });
    const tabstop = kubusEl().querySelectorAll<HTMLElement>('[data-open-fem3d-view-cube-knop][tabindex="0"]');
    gelijk(tabstop.length, 1, "één tabstop");
    gelijk(tabstop[0].closest<HTMLElement>(".open-fem3d-view-cube-vlak")!.dataset.naarKijker, "ja", "de tabstop ligt op de voorkant");
    tabstop[0].focus();
    const controleer = (wat: string) => {
      const el = actiefEl();
      ok(kubusEl().contains(el) && el.dataset.openFem3dViewCubeKnop !== undefined, `${wat}: de focus staat op een knop van de kubus`);
      gelijk(el.closest<HTMLElement>(".open-fem3d-view-cube-vlak")!.dataset.naarKijker, "ja", `${wat}: ${el.dataset.openFem3dViewCubeDoel} ligt op de voorkant`);
      const m = middenVan(el.getBoundingClientRect());
      gelijk(document.elementFromPoint(m.x, m.y), el, `${wat}: ${el.dataset.openFem3dViewCubeDoel} is te zien (bovenop)`);
      // En de focus is te zien: de cel heeft zelf geen outline (:focus), de
      // rand komt van de klasse is-focus die de kubus bij toetsenbordfocus zet.
      gelijk([el.matches(":focus-visible"), el.classList.contains("is-focus"), getComputedStyle(el).outlineStyle],
        [true, true, "solid"], `${wat}: zichtbare focusrand op ${el.dataset.openFem3dViewCubeDoel}`);
      return el.dataset.openFem3dViewCubeDoel!;
    };
    const vooruit = new Set<string>(), achteruit = new Set<string>();
    for (let i = 0; i < 25; i++) { vooruit.add(controleer(`pijl rechts ${i}`)); toets("ArrowRight", actiefEl()); }
    for (let i = 0; i < 25; i++) { achteruit.add(controleer(`pijl links ${i}`)); toets("ArrowLeft", actiefEl()); }
    gelijk([vooruit.size, achteruit.size], [19, 19], "alle 19 doelen aan de voorkant, heen en terug");
    for (const weg of ["+y", "-x", "-z", "-x+y", "-x+y-z"]) ok(!vooruit.has(weg), `${weg} (achterkant) niet bereikt`);
    toets("End", actiefEl());
    controleer("End");
    toets("Home", actiefEl());
    gelijk(controleer("Home"), "+z", "Home: het eerste doel (het dak)");
    // Focus op Rechts, dan de kubus een halve slag draaien: de focus schuift naar de voorkant.
    toets("ArrowRight", actiefEl());
    toets("ArrowRight", actiefEl());
    gelijk(controleer("op Rechts"), "+x", "pijl rechts tweemaal: dak → Voor → Rechts");
    const p = kubusPunt("-y");
    kubusWijzer("pointerdown", p.el, p.x, p.y, 0, 1);
    for (const dx of [60, 180, 350]) kubusWijzer("pointermove", p.el, p.x + dx, p.y, 0, 1);
    kubusWijzer("pointerup", p.el, p.x + 350, p.y, 0, 0);
    await wacht();
    gelijk(zichtbareVlakken().includes("rechts"), false, "Rechts draaide naar achteren");
    controleer("na een halve slag");
    gelijk(kubusEl().querySelectorAll('[data-open-fem3d-view-cube-knop][tabindex="0"]').length, 1, "nog steeds één tabstop");
    // Enter kiest het gefocuste doel.
    const doel = controleer("voor Enter");
    toets("Enter", actiefEl());
    gelijk(tekenvlakEl().dataset.openFem3dViewCubeDoel, doel, "Enter kiest het gefocuste doel");
  });

  await test("view cube: focusrand en hover ≥ 3:1 tegen vlak, hovertint en wit podium, in alle thema's; naam ≥ 4,5:1", async () => {
    await toon(portaal, { ...snel });
    const html = document.documentElement;
    const oud = html.dataset.oaTheme;
    const podium = rgb(getComputedStyle(container.querySelector(".open-fem3d-stage")!).backgroundColor);
    gelijk(podium.slice(0, 3), [255, 255, 255], "het podium is wit");
    try {
      for (const thema of ["light", "dark", "blueprint", "high-contrast-dark", "high-contrast-light"]) {
        html.dataset.oaTheme = thema;
        const meet: string[] = [];
        for (const vlak of ["boven", "voor", "onder"]) {
          const vlakKleur = rgb(getComputedStyle(vlakEl(vlak)).backgroundColor);
          const midden = vlakEl(vlak).querySelector<HTMLElement>('[data-soort="vlak"]')!;
          const rand = vlakEl(vlak).querySelector<HTMLElement>('[data-soort="ribbe"]')!;
          const randKleur = meng(rgb(getComputedStyle(rand).backgroundColor), vlakKleur);
          midden.classList.add("is-hover", "is-focus");
          const stijl = getComputedStyle(midden);
          const hoverKleur = meng(rgb(stijl.backgroundColor), vlakKleur);
          const hoverRand = rgb(stijl.boxShadow);
          const focus = rgb(stijl.outlineColor);
          midden.classList.remove("is-hover", "is-focus");
          const tekst = rgb(getComputedStyle(vlakEl(vlak).querySelector(".open-fem3d-view-cube-naam")!).color);
          for (const [naam, a, b, min] of [
            ["focus/vlak", focus, vlakKleur, 3], ["focus/ribbe", focus, randKleur, 3], ["focus/hover", focus, hoverKleur, 3],
            ["focus/podium", focus, podium, 3], ["hoverrand/hovertint", hoverRand, hoverKleur, 3], ["hoverrand/vlak", hoverRand, vlakKleur, 3],
            ["hoverrand/podium", hoverRand, podium, 3], ["naam/vlak", tekst, vlakKleur, 4.5], ["naam/hover", tekst, hoverKleur, 4.5],
          ] as const) {
            const k = contrast(a, b);
            if (k < min) meet.push(`${vlak} ${naam} ${k.toFixed(2)}:1`);
          }
        }
        // Knop ▾ en menu: focusrand tegen hun witte achtergrond en de focustint.
        const knop = menuKnopEl();
        klikEcht(knop, "knop ▾");
        const item = menuItemEl("start");
        const itemStijl = getComputedStyle(item);
        const menuAchter = rgb(getComputedStyle(menuEl()).backgroundColor);
        for (const [naam, a, b] of [
          ["menu: focusrand/achtergrond", rgb(itemStijl.outlineColor), menuAchter],
          ["menu: focusrand/focustint", rgb(itemStijl.outlineColor), meng(rgb(itemStijl.backgroundColor), menuAchter)],
        ] as const) {
          const k = contrast(a, b);
          if (k < 3) meet.push(`${naam} ${k.toFixed(2)}:1`);
        }
        toets("Escape", actiefEl());
        const knopRand = rgb(getComputedStyle(knop).borderTopColor);
        if (contrast(knopRand, podium) < 3) meet.push(`knop ▾: rand/podium ${contrast(knopRand, podium).toFixed(2)}:1`);
        // De focusrand van de knop ▾ (alleen bij :focus-visible) is de kubusfocus.
        const focusToken = getComputedStyle(knop).getPropertyValue("--theme-view-cube-focus").trim();
        const proef = document.createElement("span");
        proef.style.color = focusToken;
        document.body.appendChild(proef);
        const knopFocus = rgb(getComputedStyle(proef).color);
        proef.remove();
        if (contrast(knopFocus, podium) < 3) meet.push(`knop ▾: focus/podium ${contrast(knopFocus, podium).toFixed(2)}:1`);
        gelijk(meet, [], `thema ${thema}`);
      }
    } finally {
      if (oud === undefined) delete html.dataset.oaTheme; else html.dataset.oaTheme = oud;
    }
    const regels = [...document.styleSheets].flatMap((blad) => { try { return [...blad.cssRules]; } catch { return []; } });
    ok(regels.some((r) => r instanceof CSSStyleRule && r.selectorText.includes(".open-fem3d-view-cube-menuknop:focus-visible")
      && r.cssText.includes("var(--theme-view-cube-focus)")), "knop ▾: focusrand in de kubusfocuskleur, niet de themakleur");
  });

  await test("view cube: slepen vanuit Onder klapt het beeld niet om", async () => {
    for (const vanaf of [[-1, 1, -1], [1, 1, -1], [-1, -1, -1]]) {
      await toon(portaal, { ...snel }, { camera: vanuit(vanaf) });
      kubusKlik("-z");
      richtingIs([0, 0, -1], "Onder");
      gelijk(tekenvlakEl().dataset.openFem3dCameraUp, "0.000000,1.000000,0.000000", "Y omhoog van onderen");
      const p = kubusPunt("-z");
      kubusWijzer("pointerdown", p.el, p.x, p.y, 0, 1);
      kubusWijzer("pointermove", p.el, p.x, p.y + 4, 0, 1);
      kubusWijzer("pointermove", p.el, p.x, p.y + 8, 0, 1);
      kubusWijzer("pointerup", p.el, p.x, p.y + 8, 0, 0);
      await wacht();
      const boven = new THREE.Vector3(0, 1, 0).applyQuaternion(camera().quaternion);
      ok(boven.y > 0.95, `na een kleine sleep vanuit Onder is het scherm-boven nog +Y (${boven.toArray().map((v) => v.toFixed(3)).join(", ")})`);
      ok(cameraOffset().y > 0, "de camera komt aan de +Y-kant (geen omslag naar −Y)");
    }
  });

  await test("view cube: een tekenfoutmelding laat kubus en menu vrij en bruikbaar", async () => {
    await toonEditor(portaal, { ...snel }, { camera: { position: [0.5, -16, 14], target: [0.5, 0, 0], up: [0, 0, 1] } });
    flushSync(() => editorStuur.tool("addPlate"));
    await wacht();
    const p = { x: 260, y: 470 };
    klik(p);
    await wacht();
    klik(p);
    await wacht();
    const melding = container.querySelector<HTMLElement>(".open-fem3d-draw-error");
    ok(melding, "de melding staat er (eindpunt valt samen met het vorige punt)");
    const m = melding!.getBoundingClientRect();
    ok(!overlapt(m, kubusEl().getBoundingClientRect()), `de melding (rechts ${m.right.toFixed(0)}) ligt naast de kubus (links ${kubusEl().getBoundingClientRect().left.toFixed(0)})`);
    ok(m.width > 400, "en houdt de rest van de breedte");
    for (const id of ["+z", "-y", "+x-y+z"]) kubusPunt(id);
    klikEcht(menuKnopEl(), "knop ▾ naast de melding");
    ok(!menuEl().hidden, "het menu gaat open");
    for (const item of [...menuEl().children]) {
      const r = middenVan(item.getBoundingClientRect());
      gelijk(document.elementFromPoint(r.x, r.y), item, `${item.textContent} bovenop`);
    }
    toets("Escape", actiefEl());
    kubusKlik("+z");
    richtingIs([0, 0, 1], "een klik op het dak werkt terwijl de melding staat");
    ok(container.querySelector(".open-fem3d-draw-error"), "de melding staat er nog");
  });

  await test("view cube: laag podium — Draaien en Spiegelen niet over de statusregel; menu binnen het tekenvlak en boven het paneel", async () => {
    await toonEditor(portaal, { ...snel }, { hoog: 360 });
    flushSync(() => editorStuur.selectie({ type: "beam", id: 1 }));
    for (const tool of ["rotate", "mirror", "move"] as const) {
      flushSync(() => editorStuur.tool(tool));
      await wacht();
      const paneel = container.querySelector<HTMLElement>(".open-fem3d-transform-panel");
      ok(paneel, `paneel ${tool} open`);
      const status = container.querySelector<HTMLElement>("[data-open-fem-3d-status]")!.getBoundingClientRect();
      const r = paneel!.getBoundingClientRect();
      ok(r.bottom <= status.top - 2, `${tool}: paneel (onder ${r.bottom.toFixed(0)}) boven de statusregel (${status.top.toFixed(0)})`);
      gelijk(getComputedStyle(paneel!).overflowY, "auto", `${tool}: het paneel scrolt`);
      ok(paneel!.scrollHeight > paneel!.clientHeight, `${tool}: bij 360 px hoog past het paneel niet helemaal en scrolt het`);
    }
    // Het menu valt over het paneel en ligt erboven.
    const doek = canvasEl().getBoundingClientRect();
    klikEcht(menuKnopEl(), "knop ▾");
    const menu = menuEl().getBoundingClientRect();
    ok(menu.top >= doek.top && menu.bottom <= doek.bottom && menu.left >= doek.left && menu.right <= doek.right, "het menu valt binnen het tekenvlak");
    ok(overlapt(menu, container.querySelector(".open-fem3d-transform-panel")!.getBoundingClientRect()), "opzet: het menu valt over het paneel");
    ok(!kubusEl().querySelector(".open-fem3d-view-cube-keuze")!.hasAttribute("data-omhoog"), "er is ruimte: het menu klapt omlaag");
    for (const item of [...menuEl().children]) {
      const r = middenVan(item.getBoundingClientRect());
      gelijk(document.elementFromPoint(r.x, r.y), item, `${item.textContent} boven het paneel`);
    }
    toets("Escape", actiefEl());
    // Nog lager: het menu klapt omhoog en blijft binnen het tekenvlak.
    await toonEditor(portaal, { ...snel }, { hoog: 210 });
    klikEcht(menuKnopEl(), "knop ▾");
    const laag = menuEl().getBoundingClientRect(), doek2 = canvasEl().getBoundingClientRect();
    ok(kubusEl().querySelector(".open-fem3d-view-cube-keuze")!.hasAttribute("data-omhoog"), "te laag: het menu klapt omhoog");
    ok(laag.top >= doek2.top && laag.bottom <= doek2.bottom, `omhoog binnen het tekenvlak (${laag.top.toFixed(0)}–${laag.bottom.toFixed(0)} in ${doek2.top.toFixed(0)}–${doek2.bottom.toFixed(0)})`);
    toets("Escape", actiefEl());
  });

  await test("view cube: labels onder de kubus en onder het open menu zijn verborgen; zonder kubus (zichtbaarheid uit) niet", async () => {
    // Twee knopen achter het midden van de kubus en achter het menu (vooraanzicht).
    const camera0 = vooraanzicht(0.5, 3, 16);
    await toonEditor(portaal, { ...snel }, { camera: camera0 });
    const doek = canvasEl().getBoundingClientRect();
    const achter = (x: number, y: number) => {
      const straal = new THREE.Raycaster();
      straal.setFromCamera(new THREE.Vector2((x - doek.left) / BREED * 2 - 1, 1 - (y - doek.top) / HOOG * 2), camera());
      return straal.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())!;
    };
    const kubusMidden = middenVan(kubusEl().getBoundingClientRect());
    klikEcht(menuKnopEl(), "knop ▾");
    const menuMidden = middenVan(menuEl().getBoundingClientRect());
    toets("Escape", actiefEl());
    const a = achter(kubusMidden.x, kubusMidden.y), b = achter(menuMidden.x, menuMidden.y);
    const model = parseOpenFem3DModel({
      nodes: [{ id: 1, x: a.x, y: 0, z: a.z }, { id: 2, x: b.x, y: 0, z: b.z }, { id: 3, x: 0.5, y: 0, z: 3 }],
      beams: [],
    });
    await toonEditor(model, { ...snel, nodeNumbers: true }, { camera: camera0 });
    const label = (id: number) => [...container.querySelectorAll<HTMLElement>(".open-fem3d-node-label")].find((l) => l.textContent === String(id))!;
    ok(label(1) && label(2) && label(3), "drie knoopnummers");
    ok(overlapt(label(1).getBoundingClientRect(), kubusEl().getBoundingClientRect()), "opzet: knoop 1 ligt onder de kubus");
    gelijk([label(1).style.visibility, label(2).style.visibility, label(3).style.visibility], ["hidden", "", ""],
      "onder de kubus verborgen; onder het (dichte) menu en elders zichtbaar");
    klikEcht(menuKnopEl(), "knop ▾");
    ok(overlapt(label(2).getBoundingClientRect(), menuEl().getBoundingClientRect()), "opzet: knoop 2 ligt onder het open menu");
    gelijk(label(2).style.visibility, "hidden", "onder het open menu verborgen");
    toets("Escape", actiefEl());
    gelijk(label(2).style.visibility, "", "menu dicht: weer zichtbaar");
    // Zichtbaarheid viewCube uit: geen kubus, geen menu, geen gereserveerde plek.
    flushSync(() => editorStuur.zicht({ ...snel, nodeNumbers: true, viewCube: false }));
    await wacht();
    ok(kubusEl().hidden, "de kubus is verborgen");
    const vak = kubusEl().getBoundingClientRect();
    gelijk([vak.width, vak.height, menuKnopEl().getBoundingClientRect().width], [0, 0, 0], "kubus en knop ▾ nemen geen plek in");
    gelijk(label(1).style.visibility, "", "het label onder de (verborgen) kubus is weer te zien");
    gelijk(document.elementFromPoint(kubusMidden.x, kubusMidden.y), canvasEl(), "op de plek van de kubus ligt het canvas");
    flushSync(() => editorStuur.zicht({ ...snel, nodeNumbers: true, viewCube: true }));
    await wacht();
    ok(!kubusEl().hidden, "weer aan");
    gelijk(label(1).style.visibility, "hidden", "en het label eronder weer verborgen");
  });

  await test("view cube: zichtbaarheid viewCube — standaard aan, onder Werkvlak in het venster, in de tab Weergave, bewaard en in views", async () => {
    gelijk(DEFAULT_OPEN_FEM_3D_VISIBILITY.viewCube, true, "standaard aan");
    ok(!OPEN_FEM_3D_RESULT_LAYERS.includes("viewCube"), "geen resultaatlaag");
    // Bewaren zoals de andere zichtbaarheid; oude opslag zonder sleutel: aan.
    const sleutel = "open-fem-studio.openFem3d.visibility";
    const vorig = localStorage.getItem(sleutel);
    try {
      saveOpenFem3DVisibility({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, viewCube: false });
      gelijk(readOpenFem3DVisibility().viewCube, false, "uit bewaard");
      localStorage.setItem(sleutel, JSON.stringify({ nodes: true }));
      gelijk(readOpenFem3DVisibility().viewCube, true, "oude opslag zonder sleutel: aan");
    } finally {
      if (vorig === null) localStorage.removeItem(sleutel); else localStorage.setItem(sleutel, vorig);
    }
    const cam = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] };
    const [oud, uit] = parseOpenFem3DViewSets([
      { id: "view-1", name: "Oud", view: "iso", camera: cam, visibility: { beams: true }, combinationId: null },
      { id: "view-2", name: "Zonder kubus", view: "iso", camera: cam, visibility: { viewCube: false }, combinationId: null },
    ]);
    gelijk([oud.visibility.viewCube, uit.visibility.viewCube], [true, false], "views: oude view zonder sleutel aan, opgeslagen uit blijft uit");
    // Het venster Zichtbaarheid (groep Werkvlak) en de tab Weergave.
    let zicht = DEFAULT_OPEN_FEM_3D_VISIBILITY;
    const Lijst = () => {
      const [v, setV] = useState(DEFAULT_OPEN_FEM_3D_VISIBILITY);
      zicht = v;
      return <div className="fem-verkenner-proef">
        <ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} workspace="3d"
          gridShow={false} setGridShow={() => {}} stramienAan={false} setStramienAan={() => {}}
          openFem3dVisibility={v} setOpenFem3DVisibility={setV} />
        <OpenFem3DVisibilityDialog open onClose={() => {}} visibility={v} onChange={setV} viewSets={[]} currentView="iso"
          currentCamera={{ position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] }} currentCombinationId={null}
          currentLoadCaseId={1} currentMode="model" combinationOptions={[]} loadCaseOptions={[]} />
      </div>;
    };
    mount(<Lijst />);
    await wacht();
    const rij = document.querySelector<HTMLButtonElement>('.open-fem3d-visibility-dialog [data-vlag="viewCube"]');
    ok(rij, "de schakelaar staat in het venster");
    gelijk(rij!.closest("section")!.querySelector("h3")!.textContent, "Werkvlak", "in de groep Werkvlak");
    gelijk(rij!.textContent, "Aanzichtkubus", "tekst");
    gelijk(rij!.getAttribute("aria-checked"), "true", "aan");
    klikEcht(rij!, "schakelaar Aanzichtkubus");
    gelijk(zicht.viewCube, false, "het venster zet hem uit");
    const labels = [...container.querySelectorAll<HTMLElement>('.explorer-view-section[data-workspace="3d"] .fem-results-toggle-label')].map((l) => l.textContent);
    ok(labels.includes("Aanzichtkubus"), `in de tab Weergave (${labels.join(", ")})`);
  });

  await test("view cube: gebouwtje — dak, gevels en vloer in eigen tint, deur op Voor, maaiveld rondom dat geen klik afvangt, niet afgedrukt", async () => {
    await toon(portaal, { ...snel });
    const tint = (vlak: string) => getComputedStyle(vlakEl(vlak)).backgroundColor;
    const gevels = ["voor", "achter", "links", "rechts"].map(tint);
    ok(gevels.every((g) => g === gevels[0]), "vier gevels in dezelfde geveltint");
    ok(new Set([tint("boven"), gevels[0], tint("onder")]).size === 3, `dak, gevel en vloer verschillen (${tint("boven")}, ${gevels[0]}, ${tint("onder")})`);
    gelijk([...kubusEl().querySelectorAll(".open-fem3d-view-cube-naam")].map((n) => n.textContent),
      ["Dak", "Voor", "Rechts", "Achter", "Links", "Vloer"], "namen");
    const deuren = kubusEl().querySelectorAll<HTMLElement>(".open-fem3d-view-cube-deur");
    gelijk([deuren.length, deuren[0]?.closest<HTMLElement>(".open-fem3d-view-cube-vlak")?.dataset.vlak], [1, "voor"], "één deur, op Voor");
    gelijk(getComputedStyle(deuren[0]).pointerEvents, "none", "de deur vangt geen klikken");
    const voor = vlakEl("voor").getBoundingClientRect();
    const maaiveld = kubusEl().querySelector<HTMLElement>(".open-fem3d-view-cube-maaiveld");
    ok(maaiveld, "maaiveld");
    gelijk([getComputedStyle(maaiveld!).pointerEvents, getComputedStyle(maaiveld!).backfaceVisibility], ["none", "hidden"], "decoratief en van onderen onzichtbaar");
    ok(getComputedStyle(maaiveld!).backgroundImage.includes("repeating-linear-gradient"), "gearceerd");
    // De arcering loopt in het vlak schuin: niet evenwijdig aan een zijde van
    // de voetafdruk (anders lagen er langs Links en Rechts doorgaande lijnen),
    // en in het startaanzicht staat ze als //// op het scherm.
    const hoekTekst = /repeating-linear-gradient\((-?[\d.]+)deg/.exec(getComputedStyle(maaiveld!).backgroundImage)?.[1];
    ok(hoekTekst !== undefined, `de hoek van de arcering (${getComputedStyle(maaiveld!).backgroundImage.slice(0, 60)})`);
    const alfa = Number(hoekTekst) * Math.PI / 180;
    // Gradiënt onder alfa (CSS: 0° = naar boven, met de klok mee); de streepjes staan er loodrecht op.
    const streep = { x: Math.cos(alfa), y: Math.sin(alfa) };
    ok(Math.abs(streep.x) > 0.3 && Math.abs(streep.y) > 0.3,
      `de streepjes kruisen alle vier de stroken schuin (in het vlak ${streep.x.toFixed(3)}, ${streep.y.toFixed(3)})`);
    const opScherm = schermRichting(schermMatrix(maaiveld!), streep.x, streep.y);
    const steilte = Math.atan2(Math.abs(opScherm.y), Math.abs(opScherm.x)) * 180 / Math.PI;
    ok(opScherm.x * opScherm.y < 0 && steilte > 30 && steilte < 80,
      `in het startaanzicht //// (${opScherm.x.toFixed(3)}, ${opScherm.y.toFixed(3)}; ${steilte.toFixed(0)}° steil)`);
    const mv = maaiveld!.getBoundingClientRect();
    ok(mv.width > voor.width && mv.bottom > voor.bottom, "rondom de voet, iets groter dan de voetafdruk");
    // Onderste ribben en hoeken blijven klikbaar (het maaiveld ligt er vlak naast).
    for (const [id, richting] of [["-y-z", [0, -1, -1]], ["+x-y-z", [1, -1, -1]]] as const) {
      await toon(portaal, { ...snel });
      kubusKlik(id);
      richtingIs(richting, `${id} door het maaiveld heen te klikken`);
    }
    // Nergens in het kubusvak vangt het maaiveld de muis.
    await toon(portaal, { ...snel });
    const vak = kubusEl().getBoundingClientRect();
    for (let x = vak.left; x <= vak.right; x += 4) {
      for (let y = vak.top; y <= vak.bottom; y += 4) {
        const raak = document.elementFromPoint(x, y);
        ok(!raak?.classList.contains("open-fem3d-view-cube-maaiveld"), `het maaiveld vangt de muis in (${x}, ${y})`);
      }
    }
    // Vooraanzicht: de deur onderaan in het midden van de gevel, los van de naam.
    await toon(portaal, { ...snel }, { viewRequest: { kind: "front", token: 1 } });
    const deur = kubusEl().querySelector<HTMLElement>(".open-fem3d-view-cube-deur")!.getBoundingClientRect();
    const gevel = vlakEl("voor").getBoundingClientRect();
    ok(Math.abs(deur.bottom - gevel.bottom) < 1 && Math.abs(middenVan(deur).x - middenVan(gevel).x) < 1, "de deur onderaan in het midden");
    ok(deur.height < gevel.height / 3 && deur.width < gevel.width / 4, `een kleine deur (${deur.width.toFixed(1)} × ${deur.height.toFixed(1)})`);
    const tekst = document.createRange();
    tekst.selectNodeContents(vlakEl("voor").querySelector(".open-fem3d-view-cube-naam")!);
    ok(tekst.getBoundingClientRect().bottom <= deur.top - 2, "de deur raakt de naam niet");
    // Van onderen: de vloer is in het midden te raken (het maaiveld ligt er niet over).
    await toon(portaal, { ...snel }, { camera: vanuit([1.4, -1.4, -1]) });
    const vloer = middenVan(vlakEl("onder").getBoundingClientRect());
    gelijk((document.elementFromPoint(vloer.x, vloer.y) as HTMLElement | null)?.dataset.openFem3dViewCubeDoel, "-z", "de vloer van onderen");
    // Afdrukken: de kubus (met knop en menu) valt weg.
    const regels = [...document.styleSheets].flatMap((blad) => { try { return [...blad.cssRules]; } catch { return []; } });
    ok(regels.some((r) => r instanceof CSSMediaRule && r.media.mediaText.includes("print")
      && [...r.cssRules].some((s) => s instanceof CSSStyleRule && s.selectorText === ".open-fem3d-view-cube" && s.style.display === "none")),
    "@media print verbergt de kubus met zijn menu");
  });

  await test("view cube: aria-labels noemen het aanzicht; ribben en hoeken naar de vlaknamen; hover markeert een ribbe op beide vlakken", async () => {
    await toon(portaal, { ...snel }, { camera: schuin });
    const knop = (id: string) => kubusEl().querySelector<HTMLElement>(`[data-open-fem3d-view-cube-knop][data-open-fem3d-view-cube-doel="${id}"]`)!;
    gelijk(["+z", "-z", "-y", "+y", "-x", "+x"].map((id) => knop(id).getAttribute("aria-label")), [
      "Bovenaanzicht (dak)", "Onderaanzicht (vloer)", "Vooraanzicht (voorgevel)", "Achteraanzicht (achtergevel)",
      "Linkeraanzicht (linkergevel)", "Rechteraanzicht (rechtergevel)",
    ], "vlakken");
    gelijk(knop("+x-y+z").getAttribute("aria-label"), "Hoek Voor, Rechts, Dak", "hoek");
    gelijk(knop("-y+z").getAttribute("aria-label"), "Ribbe Voor, Dak", "ribbe");
    gelijk(kubusEl().querySelectorAll("[data-open-fem3d-view-cube-knop]").length, 26, "26 knoppen");
    gelijk(kubusEl().querySelectorAll('[role="button"]').length, 26, "26 knoppen in de toegankelijkheidsboom");
    gelijk(kubusEl().querySelector(".open-fem3d-view-cube-kubus")!.getAttribute("role"), "toolbar", "toolbar");
    const p = kubusPunt("-y+z");
    kubusWijzer("pointerover", p.el, p.x, p.y);
    gelijk(kubusEl().querySelectorAll('.is-hover[data-open-fem3d-view-cube-doel="-y+z"]').length, 2, "ribbe gemarkeerd op Voor én het dak");
    gelijk(kubusEl().querySelectorAll(".is-hover").length, 2, "verder niets gemarkeerd");
    kubusWijzer("pointerleave", kubusEl().querySelector(".open-fem3d-view-cube-kubus")!, 0, 0);
    gelijk(kubusEl().querySelectorAll(".is-hover").length, 0, "markering weg buiten de kubus");
    // Een taalwissel zet namen, labels en menu om.
    await i18next.changeLanguage("de");
    await wacht();
    gelijk([knop("+z").getAttribute("aria-label"), vlakEl("boven").textContent, menuItemEl("start").textContent,
      menuItemEl("perspectief").textContent, menuKnopEl().getAttribute("aria-label")],
    ["Draufsicht (Dach)", "Dach", "Startansicht", "Perspektive", "Ansichtsoptionen"], "Duits");
    await i18next.changeLanguage("nl");
    await wacht();
    gelijk(menuItemEl("passend").textContent, "Passend beeld", "terug naar Nederlands");
  });

  await test("view cube: een klik zet de focus — een invoerveld verliest hem; de tabstop (en een focus in de kubus) volgt het aangeklikte doel", async () => {
    await toon(portaal, { ...snel });
    const tabstop = () => [...kubusEl().querySelectorAll<HTMLElement>('[data-open-fem3d-view-cube-knop][tabindex="0"]')]
      .map((el) => el.dataset.openFem3dViewCubeDoel);
    // (a) Een keuzelijst buiten de kubus heeft de focus; een klik op Voor.
    const veld = document.createElement("select");
    veld.innerHTML = "<option>a</option><option>b</option>";
    document.body.appendChild(veld);
    try {
      veld.focus();
      gelijk(actiefEl(), veld, "opzet: de keuzelijst heeft de focus");
      kubusKlik("-y");
      richtingIs([0, -1, 0], "de klik op Voor");
      ok(actiefEl() !== veld, `de keuzelijst verliest de focus (nu ${actiefEl().nodeName})`);
      ok(actiefEl() === document.body || kubusEl().contains(actiefEl()), "de focus staat niet in een ander veld");
      gelijk(tabstop(), ["-y"], "de tabstop volgt het aangeklikte doel");
    } finally {
      veld.remove();
    }
    // (b) De focus staat al in de kubus (op het dak); een klik op Voor neemt
    // hem mee, en Enter kiest daarna Voor en niet het dak.
    await toon(portaal, { ...snel });
    kubusEl().querySelector<HTMLElement>('[data-open-fem3d-view-cube-knop][tabindex="0"]')!.focus();
    toets("Home", actiefEl());
    gelijk(actiefEl().dataset.openFem3dViewCubeDoel, "+z", "opzet: de focus op het dak");
    kubusKlik("-y");
    gelijk([actiefEl().dataset.openFem3dViewCubeDoel, tabstop()], ["-y", ["-y"]], "focus en tabstop op het aangeklikte Voor");
    toets("Enter", actiefEl());
    gelijk(tekenvlakEl().dataset.openFem3dViewCubeDoel, "-y", "Enter kiest het aangeklikte doel");
    richtingIs([0, -1, 0], "nog steeds vooraanzicht");
  });

  await test("view cube: het open menu ▾ houdt zijn toetsen — Delete en letters bereiken de editor niet; een letter springt naar een regel", async () => {
    await toonEditor(portaal, { ...snel });
    flushSync(() => editorStuur.selectie({ type: "beam", id: 1 }));
    await wacht();
    klikEcht(menuKnopEl(), "knop ▾");
    gelijk(actiefEl(), menuItemEl("start"), "opzet: het menu is open, de focus op Startaanzicht");
    const stand = () => [editorModelNu?.beams.map((b) => b.id), editorSelectieNu, editorToolNu, menuEl().hidden];
    const voor = [[1, 2], { type: "beam", id: 1 }, "select", false];
    gelijk(stand(), voor, "opzet: twee staven, staaf 1 geselecteerd, gereedschap Selecteren");
    for (const toetsNaam of ["Delete", "Backspace", "m", "M", "c", "x"]) {
      toets(toetsNaam, actiefEl());
      await wacht();
      gelijk(stand(), voor, `${toetsNaam} in het open menu: model, selectie, gereedschap en menu blijven`);
    }
    // Typ-vooruit: p → Passend beeld, nog eens p → Perspectief; s → de drie
    // regels van de section box (issue #86) en dan rondom naar Startaanzicht.
    for (const [letter, regel] of [["p", "passend"], ["p", "perspectief"], ["s", "sectionBox"], ["s", "sectionBoxSelectie"],
      ["s", "sectionBoxReset"], ["s", "start"]] as const) {
      toets(letter, actiefEl());
      gelijk(actiefEl(), menuItemEl(regel), `${letter}: naar ${regel}`);
    }
    toets("Escape", actiefEl());
    ok(menuEl().hidden, "Escape sluit");
    // Opzet: zonder open menu verwijdert Delete de geselecteerde staaf wel.
    actiefEl().blur();
    toets("Delete", document.body);
    await wacht();
    gelijk(editorModelNu?.beams.map((b) => b.id), [2], "opzet: buiten het menu verwijdert Delete staaf 1");
  });

  await test("view cube: de namen op dak en vloer zijn op ware grootte even hoog als op de gevels (≥ 6 px kapitaalhoogte in het startaanzicht)", async () => {
    await toon(portaal, { ...snel });
    // Kapitaalhoogte van de gebruikte letter (gemeten aan een H in het
    // werkelijke font), maal de schermlengte van de letter-omhoogrichting
    // door alle CSS-transformaties (scène × vlak × naam, zoom 1).
    const kapitaal = (vlak: string) => {
      const naam = vlakEl(vlak).querySelector<HTMLElement>(".open-fem3d-view-cube-naam")!;
      const stijl = getComputedStyle(naam);
      // Op 100 px gemeten en geschaald: op 10 px rondt de browser de maat af.
      const doek = document.createElement("canvas").getContext("2d")!;
      doek.font = `${stijl.fontWeight} 100px ${stijl.fontFamily}`;
      const hoogte = doek.measureText("H").actualBoundingBoxAscent / 100 * parseFloat(stijl.fontSize);
      const p = schermMatrix(naam).transformPoint(new DOMPoint(0, 1, 0, 0));
      return hoogte * Math.hypot(p.x, p.y);
    };
    ok(kubusEl().style.zoom === "", "op ware grootte (geen zoom)");
    const [dak, voor, rechts] = ["boven", "voor", "rechts"].map(kapitaal);
    ok(dak >= 6 && voor >= 6 && rechts >= 6, `kapitaalhoogte dak ${dak.toFixed(2)} px, Voor ${voor.toFixed(2)} px, Rechts ${rechts.toFixed(2)} px (≥ 6 px)`);
    ok(Math.abs(dak - voor) < 0.05 * voor, `het dak (${dak.toFixed(2)} px) even hoog als de gevel (${voor.toFixed(2)} px)`);
    await toon(portaal, { ...snel }, { camera: vanuit([1.4, -1.4, -1]) });
    const vloer = kapitaal("onder");
    ok(vloer >= 6, `de vloer van onderen: ${vloer.toFixed(2)} px (≥ 6 px)`);
  });
}

// ── Perspectief / parallel (issue #85, deel B): eigen groep, eigen browserproces ──
const diag = () => tekenvlakEl().dataset;
const parallelZicht = (v: OpenFem3DVisibility): OpenFem3DVisibility => ({ ...v, perspective: false });
const kubusTransform = () => kubusEl().querySelector<HTMLElement>(".open-fem3d-view-cube-scene")!.style.transform;
const afstandPx = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/**
 * Het tekenvlak tekent echt met de camera die de proeven uit de diagnose
 * nabouwen (camera()): het juiste type, dezelfde projectie in x en y (near
 * en far mogen verschillen) en dezelfde kijkrichting (de rotatie van de
 * kijkmatrix). Anders konden beeld en kiezen uit elkaar lopen zonder dat een
 * proef het zag.
 */
function tekentMet(projectie: "orthographic" | "perspective", wat: string) {
  const echt = renderCamera as THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
  ok(echt, `${wat}: er is getekend`);
  gelijk(projectie === "orthographic" ? (echt as THREE.OrthographicCamera).isOrthographicCamera === true
    : (echt as THREE.PerspectiveCamera).isPerspectiveCamera === true, true, `${wat}: getekend met een ${projectie}-camera`);
  const nagebouwd = camera();
  const p = echt!.projectionMatrix.elements, q = nagebouwd.projectionMatrix.elements;
  // Rij x, rij y en rij w van de projectie (kolomvolgorde); rij z hangt van near/far af.
  const projectieFout = [0, 4, 8, 12, 1, 5, 9, 13, 3, 7, 11, 15]
    .filter((i) => Math.abs(p[i] - q[i]) > 1e-5 * Math.max(1, Math.abs(q[i])));
  gelijk(projectieFout, [], `${wat}: de getekende projectie (x, y) = die uit de diagnose`);
  echt!.updateMatrixWorld();
  const a = echt!.matrixWorldInverse.elements, b = nagebouwd.matrixWorldInverse.elements;
  const draaiFout = [0, 1, 2, 4, 5, 6, 8, 9, 10].filter((i) => Math.abs(a[i] - b[i]) > 1e-5);
  gelijk(draaiFout, [], `${wat}: de getekende kijkrichting = die uit de diagnose`);
}
/** Een wielstap op het canvas (punt in canvaspixels). */
function wiel(p: Pt, deltaY: number) {
  const rect = canvasEl().getBoundingClientRect();
  flushSync(() => {
    canvasEl().dispatchEvent(new WheelEvent("wheel", {
      clientX: rect.left + p.x, clientY: rect.top + p.y, deltaY, deltaMode: 0, bubbles: true, cancelable: true,
    }));
  });
}
/** Twee liggers vóór elkaar en een kolom met dezelfde kolom tien meter erachter. */
const kolommen = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: -5, y: 0, z: 0 }, { id: 2, x: 5, y: 0, z: 0 },
    { id: 3, x: 6, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 6 },
    { id: 5, x: 6, y: 10, z: 0 }, { id: 6, x: 6, y: 10, z: 6 },
  ],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }, { id: 3, startNodeId: 5, endNodeId: 6 }],
});

async function parallelProeven() {
  await test("parallel: diagnose; één klik op of 4 px naast een staaf van de staalhal selecteert die staaf; een knoop alleen op de knoop", async () => {
    await toon(staalhal, parallelZicht({ ...snel, loads: false }));
    gelijk(diag().openFem3dProjection, "orthographic", "data-open-fem3d-projection");
    ok(Number(diag().openFem3dOrthoHalfHeight) > 1, `halve hoogte in de diagnose (${diag().openFem3dOrthoHalfHeight})`);
    const cam = camera();
    ok(cam instanceof THREE.OrthographicCamera, "de proef rekent met een parallelle camera");
    tekentMet("orthographic", "staalhal");
    ok(Math.abs(Number(diag().openFem3dWorldPerPixel) - 2 * Number(diag().openFem3dOrthoHalfHeight) / HOOG) < 1e-9,
      "wereldmaat per pixel = 2h / hoogte");
    const punten = klikpunten(staalhal, cam, () => true, [0.5, 0.35], [0, 4, -4], 21);
    ok(punten.length >= 15, `te weinig eenduidige klikpunten (${punten.length})`);
    gelijk(trefKans(punten), [], "missers");
    // 5,5 px van een knoop op de staaf: de staaf; op de knoop: de knoop.
    const knopen = new Map(staalhal.nodes.map((n) => [n.id, n]));
    const lijnen = staalhal.beams.map((b) => ({ id: b.id, start: b.startNodeId, a: scherm(cam, knopen.get(b.startNodeId)!), e: scherm(cam, knopen.get(b.endNodeId)!) }));
    const knoopPunten = staalhal.nodes.map((n) => ({ id: n.id, p: scherm(cam, n) }));
    let getest = 0;
    for (const lijn of lijnen) {
      if (getest >= 4) break;
      const lengte = Math.hypot(lijn.e.x - lijn.a.x, lijn.e.y - lijn.a.y);
      if (lengte < 40 || !binnenBeeld(lijn.a)) continue;
      const p = { x: lijn.a.x + (lijn.e.x - lijn.a.x) * 5.5 / lengte, y: lijn.a.y + (lijn.e.y - lijn.a.y) * 5.5 / lengte };
      if (lijnen.some((ander) => ander.id !== lijn.id && afstandTotLijnstuk(p, ander.a, ander.e) < 4)) continue;
      // Parallel vallen knopen achter elkaar precies samen: alleen knopen zonder buur op het scherm.
      if (knoopPunten.some((k) => k.id !== lijn.start && afstandPx(k.p, lijn.a) < 12)) continue;
      if (knoopPunten.some((k) => k.id !== lijn.start && afstandPx(k.p, p) < 12)) continue;
      selectie = null;
      klik(p);
      gelijk(selectie, { type: "beam", id: lijn.id }, `5,5 px van knoop ${lijn.start} op staaf ${lijn.id}`);
      selectie = null;
      klik(lijn.a);
      gelijk(selectie, { type: "node", id: lijn.start }, `klik op knoop ${lijn.start}`);
      getest += 1;
    }
    ok(getest >= 3, `te weinig knopen getest (${getest})`);
  });

  await test("parallel: randstaaf naast een plaat (3 px ernaast → de staaf, midden → de plaat); een lastpijl tien meter achter een ligger wint niet", async () => {
    await toon(vloer, parallelZicht({ ...snel }), { camera: { position: [3, -6, 10], target: [3, 2, 0], up: [0, 0, 1] } });
    let cam = camera();
    const a = scherm(cam, { x: 1, y: 0, z: 0 }), b = scherm(cam, { x: 5, y: 0, z: 0 });
    const binnen = scherm(cam, { x: 3, y: 0.5, z: 0 });
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    let nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;
    const midden = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((binnen.x - midden.x) * nx + (binnen.y - midden.y) * ny < 0) { nx = -nx; ny = -ny; }
    klik({ x: midden.x + 3 * nx, y: midden.y + 3 * ny });
    gelijk(selectie, { type: "beam", id: 1 }, "3 px naast de randstaaf, op de plaat");
    klik(scherm(cam, { x: 3, y: 2, z: 0 }));
    gelijk(selectie, { type: "plate", id: 1 }, "midden van de plaat");
    // Vooraanzicht: parallel ligt de pijl van de achterste ligger precies achter de voorste.
    await toon(tweeLiggers, parallelZicht({ ...snel }), { camera: vooraanzicht(3, 0.5, 15) });
    cam = camera();
    const pijl = scherm(cam, { x: 1.5, y: 10, z: 0.5 });
    selectie = null;
    klik({ x: pijl.x, y: pijl.y - 3 });
    gelijk(selectie, { type: "beam", id: 1 }, "3 px boven de voorste ligger, op de pijl erachter");
    ok(/memberLoad/.test(diag().openFem3dPickCandidates ?? ""), "de straal raakte de pijl wel");
    selectie = null;
    klik(scherm(cam, { x: 1.5, y: 10, z: 0.8 }));
    gelijk(selectie, { type: "memberLoad", id: 7 }, "klik op de pijl zelf, ver van de voorste ligger");
  });

  await test("parallel: het selectiekader pakt wat er in beeld in valt — ook de kolom tien meter erachter (in perspectief niet); crossing raakt de ligger", async () => {
    for (const [perspectief, verwacht] of [[false, [2, 3]], [true, [2]]] as const) {
      await toon(kolommen, { ...snel, nodes: false, perspective: perspectief }, { camera: vooraanzicht(0.5, 3, 16) });
      gelijk(diag().openFem3dProjection, perspectief ? "perspective" : "orthographic", "projectie");
      tekentMet(perspectief ? "perspective" : "orthographic", "kolommen");
      const cam = camera();
      const a = scherm(cam, { x: 6, y: 0, z: 0 }), b = scherm(cam, { x: 6, y: 0, z: 6 });
      const linksBoven = { x: Math.min(a.x, b.x) - 12, y: Math.min(a.y, b.y) - 12 };
      const rechtsOnder = { x: Math.max(a.x, b.x) + 12, y: Math.max(a.y, b.y) + 12 };
      selectie = null;
      wijzer("pointerdown", linksBoven, 0, 1);
      wijzer("pointermove", rechtsOnder, 0, 1);
      wijzer("pointerup", rechtsOnder, 0, 0);
      const s = selectie as OpenFem3DSelection;
      const staven = s?.type === "beam" ? [s.id] : s?.type === "multi" ? s.beamIds : [];
      gelijk(staven, verwacht, `venster om de voorste kolom (${perspectief ? "perspectief" : "parallel"})`);
    }
    await toon(kolommen, parallelZicht({ ...snel, nodes: false }), { camera: vooraanzicht(0.5, 3, 16) });
    const cam = camera();
    const m = scherm(cam, { x: 0, y: 0, z: 0 });
    selectie = null;
    wijzer("pointerdown", { x: m.x + 40, y: m.y - 30 }, 0, 1);
    wijzer("pointermove", { x: m.x - 40, y: m.y + 30 }, 0, 1);
    wijzer("pointerup", { x: m.x - 40, y: m.y + 30 }, 0, 0);
    gelijk(selectie, { type: "beam", id: 1 }, "crossing van rechts naar links over de ligger");
  });

  await test("parallel: de wielzoom houdt het punt onder de muis vast (op een kolom, naast het model, uitzoomen) en schaalt de halve hoogte", async () => {
    await toon(portaal, parallelZicht({ ...snel }), { camera: schuin });
    for (const [wat, punt, deltaY, bron] of [
      ["op de kolom", { x: 6, y: 0, z: 4.5 }, -240, "geometry"],
      ["naast het model", { x: -9, y: 0, z: 7 }, -120, "cursor-model-depth"],
      ["uitzoomen op de ligger", { x: 2, y: 0, z: 0 }, 300, "geometry"],
    ] as const) {
      // Een muis staat op hele pixels (ook WheelEvent.clientX): het punt
      // onder de muis ligt op de straal door die pixel, hier op de diepte van
      // `punt`. Parallel staat die hele straal op één schermplek.
      const cam0 = camera();
      const exact = scherm(cam0, punt);
      const voor = { x: Math.round(exact.x), y: Math.round(exact.y) };
      ok(voor.x > 30 && voor.x < BREED - 150 && voor.y > 90 && voor.y < HOOG - 40, `${wat}: opzet, het punt ligt vrij in beeld`);
      const onder = new THREE.Vector3(voor.x / BREED * 2 - 1, 1 - voor.y / HOOG * 2,
        new THREE.Vector3(punt.x, punt.y, punt.z).project(cam0).z).unproject(cam0);
      const h0 = Number(diag().openFem3dOrthoHalfHeight);
      const doel0 = diag().openFem3dCameraTarget;
      wiel(voor, deltaY);
      await wacht();
      const stap = Math.pow(0.95, 2.4 * Math.abs(deltaY * 0.01));
      const h1 = Number(diag().openFem3dOrthoHalfHeight);
      ok(Math.abs(h1 / h0 - (deltaY < 0 ? stap : 1 / stap)) < 1e-6, `${wat}: halve hoogte × ${(h1 / h0).toFixed(5)}, verwacht × ${(deltaY < 0 ? stap : 1 / stap).toFixed(5)}`);
      gelijk(diag().openFem3dWheelAnchor, bron, `${wat}: anker`);
      gelijk(diag().openFem3dProjection, "orthographic", "nog parallel");
      tekentMet("orthographic", `${wat}: na de wielstap`);
      ok(diag().openFem3dCameraTarget !== doel0, `${wat}: het doel schoof naar het anker`);
      const na = scherm(camera(), onder);
      ok(afstandPx(na, voor) < 0.05, `${wat}: het punt onder de muis verschoof ${afstandPx(na, voor).toFixed(4)} px`);
    }
  });

  await test("parallel: pannen met de scrollknop volgt de muis één op één, voor een punt op de voorste ligger én op de achterste", async () => {
    await toon(tweeLiggers, parallelZicht({ ...snel }), { camera: { position: [3, -15, 6], target: [3, -5, 3.5], up: [0, 0, 1] } });
    const punten = [{ x: 3, y: 0, z: 0.5 }, { x: 3, y: 10, z: 0 }];
    const voor = punten.map((p) => scherm(camera(), p));
    const start = voor[0];
    wijzer("pointerdown", start, 1, 4);
    gelijk(diag().openFem3dPanSpeed, "1.000", "pansnelheid 1: geen dieptecorrectie nodig");
    for (const [dx, dy] of [[10, -4], [25, -12], [40, -25]]) wijzer("pointermove", { x: start.x + dx, y: start.y + dy }, 1, 4);
    wijzer("pointerup", { x: start.x + 40, y: start.y - 25 }, 1, 0);
    await wacht();
    const na = punten.map((p) => scherm(camera(), p));
    for (const [i, naam] of [[0, "voorste ligger"], [1, "achterste ligger"]] as const) {
      const fout = Math.hypot(na[i].x - voor[i].x - 40, na[i].y - voor[i].y + 25);
      ok(fout < 0.5, `${naam}: ${fout.toFixed(3)} px naast de muis (verwacht +40, −25 px)`);
    }
    gelijk(diag().openFem3dProjection, "orthographic", "nog parallel");
    tekentMet("orthographic", "na pannen");
  });

  await test("parallel: rechts slepen met een selectie draait om het midden daarvan; de camera blijft vóór het hele model", async () => {
    await toon(portaal, parallelZicht({ ...snel }), { camera: schuin });
    let cam = camera();
    klik(scherm(cam, { x: 6, y: 0, z: 3 }));
    gelijk(selectie, { type: "beam", id: 2 }, "kolom geselecteerd");
    const draaipunt = { x: 6, y: 0, z: 3 };
    const voor = scherm(cam, draaipunt);
    const start = { x: 300, y: 400 };
    wijzer("pointerdown", start, 2, 2);
    gelijk(diag().openFem3dOrbitPivot, "6.000000,0.000000,3.000000", "draaipunt = midden van de kolom");
    for (const [dx, dy] of [[30, 5], [70, 12], [160, -60]]) wijzer("pointermove", { x: start.x + dx, y: start.y + dy }, 2, 2);
    wijzer("pointerup", { x: start.x + 160, y: start.y - 60 }, 2, 0);
    await wacht();
    cam = camera();
    const na = scherm(cam, draaipunt);
    ok(afstandPx(na, voor) < 0.5, `het draaipunt verschoof ${afstandPx(na, voor).toFixed(3)} px`);
    gelijk(diag().openFem3dProjection, "orthographic", "nog parallel");
    ok(cameraOffset().normalize().distanceTo(vector(`${schuin.position.join(",")}`).sub(vector(schuin.target.join(","))).normalize()) > 0.1,
      "de camera draaide");
    // Het nabije vlak van de parallelle camera ligt in het camerapunt: elke knoop moet ervóór liggen.
    const kijk = cam.getWorldDirection(new THREE.Vector3());
    const diepten = portaal.nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z).sub(cam.position).dot(kijk));
    ok(diepten.every((d) => d > 1), `diepte van de knopen vanaf de camera: ${diepten.map((d) => d.toFixed(2)).join(", ")}`);
  });

  await test("parallel: oplegging en veer — leeg canvas → rasterpunt op het werkvlak onder de muis; 6 px naast een knoop → die knoop", async () => {
    geplaatst = [];
    await toon(portaal, parallelZicht({ ...snel }), { camera: { position: [8, -14, 12], target: [0.5, 0, 0], up: [0, 0, 1] }, workPlaneZ: 2 });
    gelijk(diag().openFem3dProjection, "orthographic", "parallel");
    flushSync(() => zetGereedschap("support:pinned"));
    await wacht();
    const cam = camera();
    klik(scherm(cam, { x: -2, y: 4, z: 2 }));
    gelijk(geplaatst.at(-1), { position: { x: -2, y: 4, z: 2 } }, "leeg canvas → rasterpunt op het werkvlak z = 2 m");
    // Weg van de kolom die op knoop 3 staat: anders wint de staaf de klik.
    const knoop = scherm(cam, { x: 6, y: 0, z: 0 }), boven = scherm(cam, { x: 6, y: 0, z: 6 });
    const l = afstandPx(knoop, boven);
    klik({ x: knoop.x - 6 * (boven.x - knoop.x) / l, y: knoop.y - 6 * (boven.y - knoop.y) / l });
    gelijk(geplaatst.at(-1), { nodeId: 3 }, "6 px naast knoop 3");
    flushSync(() => zetGereedschap("spring:kz"));
    await wacht();
    klik(scherm(cam, { x: 1, y: 3, z: 2 }));
    gelijk(geplaatst.at(-1), { position: { x: 1, y: 3, z: 2 } }, "veergereedschap: ook in leeg canvas");
    gelijk(geplaatst.length, 3, "drie plaatsingen");
  });

  await test("parallel: lage kijkhoek (10°) — een klik onderin op leeg canvas plaatst een oplegging op het werkvlak, ook waar dat achter het cameravlak ligt", async () => {
    geplaatst = [];
    const elevatie = 10 * Math.PI / 180, d = 25;
    await toon(portaal, parallelZicht({ ...snel }), {
      camera: { position: [0.5, -d * Math.cos(elevatie), 3 + d * Math.sin(elevatie)], target: [0.5, 0, 3], up: [0, 0, 1] },
      workPlaneZ: 0,
    });
    gelijk(diag().openFem3dProjection, "orthographic", "parallel");
    flushSync(() => zetGereedschap("support:pinned"));
    await wacht();
    const cam = camera();
    const kijk = cam.getWorldDirection(new THREE.Vector3());
    let achter = 0, voor = 0;
    for (const y of [-12, -20, -26, -30, -34, -38, -42, -46]) {
      for (const x of [-3, 4]) {
        const p = scherm(cam, { x, y, z: 0 });
        if (!(p.y > 380 && p.y < HOOG - 8 && p.x > 40 && p.x < BREED - 160)) continue;
        // Diepte vanaf het cameravlak (daar begint de straal): negatief = erachter.
        const diepte = new THREE.Vector3(x, y, 0).sub(cam.position).dot(kijk);
        if (diepte < 0) achter += 1; else voor += 1;
        klik(p);
        gelijk(geplaatst.at(-1), { position: { x, y, z: 0 } },
          `rasterpunt (${x}, ${y}, 0) op ${p.y.toFixed(0)} px, ${diepte.toFixed(1)} m ${diepte < 0 ? "achter" : "vóór"} het cameravlak`);
      }
    }
    ok(achter >= 2 && voor >= 2, `opzet: punten vóór (${voor}) en achter (${achter}) het cameravlak geprobeerd`);
    tekentMet("orthographic", "lage kijkhoek");
  });

  await test("parallel: knopen precies achter elkaar — een klik en de tekensnap kiezen de voorste knoop, in vooraanzicht en zijaanzicht", async () => {
    // Ruimtelijk raamwerk x ∈ {0, 6, 12}, y ∈ {0, 6, 12, 18}, z ∈ {0, 4}:
    // kolommen, en liggers in X en Y bovenop.
    const xs = [0, 6, 12], ys = [0, 6, 12, 18];
    const nodes: { id: number; x: number; y: number; z: number }[] = [];
    const idVan = new Map<string, number>();
    for (const z of [0, 4]) for (const y of ys) for (const x of xs) {
      nodes.push({ id: nodes.length + 1, x, y, z });
      idVan.set(`${x},${y},${z}`, nodes.length);
    }
    const k = (x: number, y: number, z: number) => idVan.get(`${x},${y},${z}`)!;
    const beams: { id: number; startNodeId: number; endNodeId: number }[] = [];
    const staaf = (a: number, b: number) => beams.push({ id: beams.length + 1, startNodeId: a, endNodeId: b });
    for (const y of ys) for (const x of xs) staaf(k(x, y, 0), k(x, y, 4));
    for (const y of ys) for (let i = 0; i + 1 < xs.length; i++) staaf(k(xs[i], y, 4), k(xs[i + 1], y, 4));
    for (const x of xs) for (let i = 0; i + 1 < ys.length; i++) staaf(k(x, ys[i], 4), k(x, ys[i + 1], 4));
    const raamwerk = parseOpenFem3DModel({ nodes, beams });
    for (const [aanzicht, kliks, tekenen] of [
      ["front", [[0, 0, 4], [6, 0, 4], [12, 0, 4], [12, 0, 0]], [[[0, 0, 0], [6, 0, 4]], [[6, 0, 0], [12, 0, 4]]]],
      ["side", [[12, 0, 4], [12, 6, 4], [12, 18, 4]], [[[12, 0, 0], [12, 6, 4]]]],
    ] as const) {
      // Muis op hele pixels, zoals een echte muis.
      const pixel = (p: readonly number[]) => {
        const e = scherm(camera(), { x: p[0], y: p[1], z: p[2] });
        return { x: Math.round(e.x), y: Math.round(e.y) };
      };
      const achterElkaar = (p: readonly number[], m: string) => {
        const e = scherm(camera(), { x: p[0], y: p[1], z: p[2] });
        ok(raamwerk.nodes.some((n) => n.id !== k(p[0], p[1], p[2]) && afstandPx(scherm(camera(), n), e) < 1e-3),
          `opzet ${m}: er ligt een knoop precies achter (${p.join(", ")})`);
      };
      await toon(raamwerk, parallelZicht({ ...snel, loads: false }), { viewRequest: { kind: aanzicht, token: 1 } });
      gelijk(diag().openFem3dProjection, "orthographic", `${aanzicht}: parallel`);
      for (const p of kliks) {
        achterElkaar(p, `${aanzicht} klik`);
        selectie = null;
        klik(pixel(p));
        gelijk(selectie, { type: "node", id: k(p[0], p[1], p[2]) },
          `${aanzicht}: een klik op de voorste knoop (${p.join(", ")}) [${diag().openFem3dPickReason}]`);
      }
      for (const [a, b] of tekenen) {
        await toon(raamwerk, parallelZicht({ ...snel, loads: false }), { viewRequest: { kind: aanzicht, token: 1 } });
        flushSync(() => zetGereedschap("addBeam"));
        await wacht();
        achterElkaar(a, `${aanzicht} tekenen`);
        achterElkaar(b, `${aanzicht} tekenen`);
        klik(pixel(a));
        gelijk(selectie, { type: "node", id: k(a[0], a[1], a[2]) }, `${aanzicht}: het begin snapt op de voorste knoop (${a.join(", ")})`);
        klik(pixel(b));
        const nieuw = (gewijzigd as OpenFem3DModel | null)?.beams.find((beam) => beam.id > raamwerk.beams.length);
        gelijk(nieuw && [nieuw.startNodeId, nieuw.endNodeId], [k(a[0], a[1], a[2]), k(b[0], b[1], b[2])],
          `${aanzicht}: de getekende staaf (${a.join(", ")}) → (${b.join(", ")}) tussen de voorste knopen`);
      }
    }
  });

  await test("parallel: een knoop ver buiten het model erbij — de camera staat weer vóór de hele scène, zonder dat het beeld verandert", async () => {
    const zicht = parallelZicht({ ...snel });
    await toon(portaal, zicht, { camera: schuin });
    const beeld = () => [diag().openFem3dCameraTarget, diag().openFem3dOrthoHalfHeight, diag().openFem3dCameraUp];
    const voor = beeld(), richting = cameraOffset().normalize();
    // 40 m achter de camera (aan de kant van de kijker): zonder nieuwe plaats viel hij achter het nabije vlak.
    const ver = vector(diag().openFem3dCameraPosition).addScaledVector(richting, 40);
    const groter = parseOpenFem3DModel({
      nodes: [...portaal.nodes, { id: 9, x: ver.x, y: ver.y, z: ver.z }],
      beams: [...portaal.beams, { id: 3, startNodeId: 4, endNodeId: 9 }],
    });
    flushSync(() => root.render(<Tekenvlak model={groter} visibility={zicht} camera={schuin} />));
    await wacht(200);
    gelijk(beeld(), voor, "doel, schaal en up blijven");
    ok(cameraOffset().normalize().distanceTo(richting) < 1e-6, "dezelfde kijkrichting");
    const cam = camera();
    const kijk = cam.getWorldDirection(new THREE.Vector3());
    const diepte = ver.clone().sub(cam.position).dot(kijk);
    ok(diepte > 1, `de nieuwe knoop ligt ${diepte.toFixed(2)} m vóór de camera`);
  });

  await test("parallel: passend beeld toont alle knopen binnen het beeld, met dezelfde vrije randen als in perspectief (vier aanzichten)", async () => {
    const vrij = { x: 24, y: 44 };
    for (const [naam, model, views] of [
      ["portaal", portaal, ["iso", "top", "front", "side"]], ["twee liggers", tweeLiggers, ["iso", "top"]], ["staalhal", staalhal, ["iso"]],
    ] as const) {
      for (const view of views) {
        await toon(model, parallelZicht({ ...snel, loads: false }), { viewRequest: { kind: view, token: 1 } });
        const cam = camera();
        tekentMet("orthographic", `${naam} ${view}`);
        for (const knoop of model.nodes) {
          const p = scherm(cam, knoop);
          ok(p.x >= vrij.x - 0.5 && p.x <= BREED - vrij.x + 0.5 && p.y >= vrij.y - 0.5 && p.y <= HOOG - vrij.y + 0.5,
            `${naam} ${view}: knoop ${knoop.id} op (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) buiten het bruikbare beeld`);
        }
        // De marge: passend beeld zet de acht hoeken van de begrenzing (de
        // knopen plus een paar centimeter voor de knoopbol) precies op 1/1,08
        // van het bruikbare deel, zoals in perspectief. De hoeken van de
        // knopenbegrenzing liggen dus net daarbinnen; een te ruim of te krap
        // frustum (bijv. × 1,05) valt buiten de band.
        const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        for (const k of model.nodes) { min.min(new THREE.Vector3(k.x, k.y, k.z)); max.max(new THREE.Vector3(k.x, k.y, k.z)); }
        let vulling = 0;
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
          const p = scherm(cam, { x, y, z });
          vulling = Math.max(vulling, Math.abs(p.x - BREED / 2) / (BREED / 2 - vrij.x), Math.abs(p.y - HOOG / 2) / (HOOG / 2 - vrij.y));
        }
        ok(vulling > 0.88 && vulling <= 1 / 1.08 + 0.002,
          `${naam} ${view}: de hoeken van het model op ${(vulling * 100).toFixed(1)} % van het bruikbare deel (verwacht net onder ${(100 / 1.08).toFixed(1)} %)`);
      }
    }
  });

  await test("Perspectief in het menu ▾ (menuitemcheckbox): heen en terug behoudt doel, richting, up en zichtbare grootte; de kubus blijft gelijk; geen herbouw", async () => {
    await toonEditor(portaal, { ...snel }, { camera: schuin });
    gelijk(diag().openFem3dProjection, "perspective", "standaard perspectief");
    const item = () => menuItemEl("perspectief");
    gelijk([item().getAttribute("role"), item().getAttribute("aria-checked"), item().textContent],
      ["menuitemcheckbox", "true", "Perspectief"], "schakelaar, aangevinkt");
    const voor = {
      doel: diag().openFem3dCameraTarget, positie: diag().openFem3dCameraPosition, up: diag().openFem3dCameraUp,
      richting: cameraOffset().normalize(), maat: Number(diag().openFem3dWorldPerPixel), kubus: kubusTransform(),
      afstand: cameraOffset().length(),
    };
    const vergelijk = (stand: string) => {
      gelijk(diag().openFem3dCameraTarget, voor.doel, `${stand}: doel`);
      gelijk(diag().openFem3dCameraUp, voor.up, `${stand}: up`);
      ok(cameraOffset().normalize().distanceTo(voor.richting) < 1e-6, `${stand}: kijkrichting`);
      const maat = Number(diag().openFem3dWorldPerPixel);
      ok(Math.abs(maat - voor.maat) < 1e-9 * voor.maat, `${stand}: wereldmaat per pixel ${maat} ≠ ${voor.maat}`);
      gelijk(kubusTransform(), voor.kubus, `${stand}: de kubus staat precies zo`);
    };
    cameraOpgeslagen = null;
    klikEcht(menuKnopEl(), "knop ▾");
    klikEcht(item(), "Perspectief");
    await wacht();
    gelijk(editorZichtNu?.perspective, false, "de zichtbaarheid perspective staat uit");
    gelijk(diag().openFem3dProjection, "orthographic", "parallel");
    gelijk(item().getAttribute("aria-checked"), "false", "vinkje weg");
    gelijk(actiefEl(), menuKnopEl(), "de focus terug op de knop ▾");
    gelijk(diag().openFem3dBuildMode, "projection", "de scène is niet opnieuw opgebouwd");
    vergelijk("parallel");
    tekentMet("orthographic", "na het menu-item Perspectief");
    const h = Number(diag().openFem3dOrthoHalfHeight);
    ok(Math.abs(h - voor.afstand * Math.tan(25 * Math.PI / 180)) < 1e-9 * h, `h = d · tan(fov/2): ${h}`);
    ok(cameraOpgeslagen !== null && Math.abs((cameraOpgeslagen as OpenFem3DCameraState).orthoHalfHeight! - h) < 1e-9 * h,
      "de bewaarde camera draagt de halve hoogte");
    cameraBijna([cameraOpgeslagen ? (cameraOpgeslagen as OpenFem3DCameraState).position.join(",") : ""], [voor.positie],
      "de bewaarde positie is die van de perspectiefcamera met dezelfde grootte");
    // Terug met het toetsenbord: Enter op de regel.
    cameraOpgeslagen = null;
    menuKnopEl().focus();
    toets("Enter", menuKnopEl());
    // Perspectief is de derde regel (sinds issue #86 staat de section box eronder, dus niet End).
    toets("Home", actiefEl());
    toets("ArrowDown", actiefEl());
    toets("ArrowDown", actiefEl());
    ok(actiefEl() === item(), "pijl omlaag: de schakelaar Perspectief");
    toets("Enter", actiefEl());
    await wacht();
    gelijk([editorZichtNu?.perspective, diag().openFem3dProjection, item().getAttribute("aria-checked")],
      [true, "perspective", "true"], "terug naar perspectief");
    vergelijk("terug");
    tekentMet("perspective", "terug naar perspectief");
    cameraBijna([diag().openFem3dCameraPosition], [voor.positie], "dezelfde camerapositie als vóór het wisselen");
    ok(cameraOpgeslagen !== null && (cameraOpgeslagen as OpenFem3DCameraState).orthoHalfHeight === undefined,
      "in perspectief geen halve hoogte in de bewaarde camera");
    // Ook na zoomen en draaien in parallel blijft de grootte bij het terugwisselen gelijk.
    flushSync(() => editorStuur.zicht(parallelZicht({ ...snel })));
    await wacht();
    wiel({ x: 420, y: 380 }, -360);
    await wacht();
    const parallelMaat = Number(diag().openFem3dWorldPerPixel), parallelDoel = diag().openFem3dCameraTarget;
    const parallelRichting = cameraOffset().normalize();
    flushSync(() => editorStuur.zicht({ ...snel }));
    await wacht();
    ok(Math.abs(Number(diag().openFem3dWorldPerPixel) - parallelMaat) < 1e-9 * parallelMaat, "na zoomen in parallel: zelfde grootte in perspectief");
    gelijk(diag().openFem3dCameraTarget, parallelDoel, "na zoomen: zelfde doel");
    ok(cameraOffset().normalize().distanceTo(parallelRichting) < 1e-6, "na zoomen: zelfde richting");
  });

  await test("parallel: de view cube volgt — Dak en een hoek geven de lintcamera met passende schaal, slepen draait om het doel; het blijft parallel", async () => {
    await toon(portaal, parallelZicht({ ...snel }), { viewRequest: { kind: "top", token: 1 } });
    const lint = cameraTekst(), lintSchaal = diag().openFem3dOrthoHalfHeight;
    await toon(portaal, parallelZicht({ ...snel }), { camera: schuin });
    kubusKlik("+z", 1);
    richtingIs([0, 0, 1], "Dak");
    gelijk(cameraTekst(), lint, "Dak = lintknop Boven, ook parallel");
    gelijk(diag().openFem3dOrthoHalfHeight, lintSchaal, "dezelfde passende halve hoogte");
    const vak = kubusEl().getBoundingClientRect();
    gelijk((document.elementFromPoint(vak.left + vak.width / 2, vak.top + vak.height / 2) as HTMLElement | null)?.dataset.openFem3dViewCubeDoel,
      "+z", "het dak midden op de kubus");
    kubusKlik("+x-y+z");
    richtingIs([1, -1, 1], "hoek Voor-Rechts-Dak");
    const voor = cameraOffset(), schaal = diag().openFem3dOrthoHalfHeight, kubus0 = kubusTransform();
    const p = kubusPunt("-y");
    kubusWijzer("pointerdown", p.el, p.x, p.y, 0, 1);
    for (const dx of [10, 25, 40]) kubusWijzer("pointermove", p.el, p.x + dx, p.y, 0, 1);
    kubusWijzer("pointerup", p.el, p.x + 40, p.y, 0, 0);
    await wacht();
    const na = cameraOffset();
    const azimut = (v: THREE.Vector3) => Math.atan2(v.y, v.x);
    ok(Math.abs(azimut(na) - azimut(voor) + 2 * Math.PI * 40 / HOOG) < 1e-4, "40 px slepen: dezelfde draai als in perspectief");
    gelijk([diag().openFem3dProjection, diag().openFem3dOrthoHalfHeight], ["orthographic", schaal], "parallel, zelfde schaal");
    tekentMet("orthographic", "na slepen op de kubus");
    ok(kubusTransform() !== kubus0, "de kubus draaide mee");
    gelijk(zichtbareVlakken(), ["boven", "rechts", "voor"], "nog steeds Voor, Rechts en het dak naar de kijker");
  });

  await test("parallel: een view met perspective = uit herstelt zijn schaal (orthoHalfHeight); een oude view zonder veld krijgt de schaal uit de afstand", async () => {
    await toonEditor(portaal, parallelZicht({ ...snel }));
    const doel: [number, number, number] = [0.5, 0, 3];
    flushSync(() => editorStuur.camera({ position: [10, -10, 8], target: doel, up: [0, 0, 1], orthoHalfHeight: 3.25 }));
    await wacht();
    ok(Math.abs(Number(diag().openFem3dOrthoHalfHeight) - 3.25) < 1e-9, `schaal hersteld (${diag().openFem3dOrthoHalfHeight})`);
    gelijk(diag().openFem3dCameraTarget, "0.500000,0.000000,3.000000", "doel");
    richtingIs([9.5, -10, 5], "richting van de view");
    ok(Math.abs((cameraOpgeslagen as OpenFem3DCameraState | null)?.orthoHalfHeight ?? NaN) - 3.25 < 1e-9, "en zo bewaard");
    flushSync(() => editorStuur.camera({ position: [10, -10, 8], target: doel, up: [0, 0, 1] }));
    await wacht();
    const d = Math.hypot(9.5, -10, 5);
    ok(Math.abs(Number(diag().openFem3dOrthoHalfHeight) - d * Math.tan(25 * Math.PI / 180)) < 1e-9, "oude view: h = d · tan(fov/2)");
    // Dezelfde view in perspectief: de bewaarde positie geeft dezelfde grootte.
    flushSync(() => editorStuur.zicht({ ...snel }));
    await wacht();
    const r = new THREE.Vector3(9.5, -10, 5).normalize().multiplyScalar(3.25 / Math.tan(25 * Math.PI / 180));
    flushSync(() => editorStuur.camera({ position: [0.5 + r.x, r.y, 3 + r.z], target: doel, up: [0, 0, 1], orthoHalfHeight: 3.25 }));
    await wacht();
    ok(Math.abs(Number(diag().openFem3dWorldPerPixel) - 2 * 3.25 / HOOG) < 1e-9, "perspectief: dezelfde wereldmaat per pixel bij het doel");
  });

  await test("zichtbaarheid perspective — standaard aan, onder Werkvlak in het venster, in de tab Weergave, bewaard en in views", async () => {
    gelijk(DEFAULT_OPEN_FEM_3D_VISIBILITY.perspective, true, "standaard aan");
    const sleutel = "open-fem-studio.openFem3d.visibility";
    const vorig = localStorage.getItem(sleutel);
    try {
      saveOpenFem3DVisibility({ ...DEFAULT_OPEN_FEM_3D_VISIBILITY, perspective: false });
      gelijk(readOpenFem3DVisibility().perspective, false, "uit bewaard");
      localStorage.setItem(sleutel, JSON.stringify({ nodes: true }));
      gelijk(readOpenFem3DVisibility().perspective, true, "oude opslag zonder sleutel: aan");
    } finally {
      if (vorig === null) localStorage.removeItem(sleutel); else localStorage.setItem(sleutel, vorig);
    }
    let zicht = DEFAULT_OPEN_FEM_3D_VISIBILITY;
    const Lijst = () => {
      const [v, setV] = useState(DEFAULT_OPEN_FEM_3D_VISIBILITY);
      zicht = v;
      return <div className="fem-verkenner-proef">
        <ExplorerViewTab displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} workspace="3d"
          gridShow={false} setGridShow={() => {}} stramienAan={false} setStramienAan={() => {}}
          openFem3dVisibility={v} setOpenFem3DVisibility={setV} />
        <OpenFem3DVisibilityDialog open onClose={() => {}} visibility={v} onChange={setV} viewSets={[]} currentView="iso"
          currentCamera={{ position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] }} currentCombinationId={null}
          currentLoadCaseId={1} currentMode="model" combinationOptions={[]} loadCaseOptions={[]} />
      </div>;
    };
    mount(<Lijst />);
    await wacht();
    const rij = document.querySelector<HTMLButtonElement>('.open-fem3d-visibility-dialog [data-vlag="perspective"]');
    ok(rij, "de schakelaar staat in het venster");
    gelijk(rij!.closest("section")!.querySelector("h3")!.textContent, "Werkvlak", "in de groep Werkvlak");
    gelijk([rij!.textContent, rij!.getAttribute("aria-checked")], ["Perspectief", "true"], "tekst, aan");
    klikEcht(rij!, "schakelaar Perspectief");
    gelijk(zicht.perspective, false, "het venster zet hem uit");
    const labels = [...container.querySelectorAll<HTMLElement>('.explorer-view-section[data-workspace="3d"] .fem-results-toggle-label')].map((l) => l.textContent);
    ok(labels.includes("Perspectief"), `in de tab Weergave (${labels.join(", ")})`);
    // In een editor: de schakelaar van het venster wisselt de camera (zelfde sleutel als het menu).
    await toonEditor(portaal, { ...snel });
    flushSync(() => editorStuur.zicht(parallelZicht({ ...snel })));
    await wacht();
    gelijk([diag().openFem3dProjection, menuItemEl("perspectief").getAttribute("aria-checked")], ["orthographic", "false"],
      "zichtbaarheid uit → parallel, vinkje in het menu weg");
  });
}

// ── Waarden bij de snedekrachtlijnen (issue #95): eigen groep, eigen browserproces ──
// Dertig losse liggers naast elkaar (6 m, 1,5 m h.o.h.) met een verzonnen My:
// staaf i (0 … 29) heeft My = (i + 1) · (4t(1 − t) − 0,25) in 11 punten, het
// uiterste in het midden; N = i + 1 (begin) en −(i + 1) (eind). Per staaf dus
// drie My-labels (begin, eind, uiterste) en één N-label. Indeling bij 30
// staven: elke tweede staaf (15 staven). Vóór #95: 15 × 3 = 45 My-labels.
const RIJ = 30;
const rijModel = parseOpenFem3DModel({
  nodes: Array.from({ length: RIJ }, (_, i) => [
    { id: 2 * i + 1, x: 0, y: 1.5 * i, z: 0 }, { id: 2 * i + 2, x: 6, y: 1.5 * i, z: 0 },
  ]).flat(),
  beams: Array.from({ length: RIJ }, (_, i) => ({ id: i + 1, startNodeId: 2 * i + 1, endNodeId: 2 * i + 2 })),
});
const rijPunten = (i: number) => Array.from({ length: 11 }, (_, k) => ({ t: k / 10, value: (i + 1) * (4 * (k / 10) * (1 - k / 10) - 0.25) }));
const rijResultaat = {
  schemaVersion: 1, engine: { id: "proef", name: "proef", revision: "0", license: "-" }, analysis: "linear",
  displacements: rijModel.nodes.map((node) => ({ nodeId: node.id, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
  reactions: [],
  memberForces: rijModel.beams.map((beam, i) => ({
    memberId: beam.id, lengthM: 6, nStartKn: i + 1, nEndKn: -(i + 1), vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
    torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: -0.25 * (i + 1), myEndKnm: -0.25 * (i + 1), mzStartKnm: 0, mzEndKnm: 0,
  })),
  diagrams: {
    momentY: rijModel.beams.map((beam, i) => ({
      memberId: beam.id, points: rijPunten(i), maxValue: 0.75 * (i + 1), minValue: -0.25 * (i + 1), maxAbsValue: 0.75 * (i + 1),
    })),
    momentZ: [], shearY: [], shearZ: [], axial: [], torsion: [],
  },
  buckling: { status: "unavailable", modes: [] }, diagnostics: [],
} as unknown as OpenFem3DSolveResult;
const rijZicht: OpenFem3DVisibility = {
  ...snel, deformation: false, reactions: false, utilization: false, loads: false, momentY: true,
};
/** Een verzonnen resultaat met alleen My (de punten per staaf, op volgorde van model.beams); de rest 0. */
const myResultaat = (model: OpenFem3DModel, punten: (index: number) => { t: number; value: number }[]) => {
  const perStaaf = model.beams.map((_, i) => punten(i));
  return {
    schemaVersion: 1, engine: { id: "proef", name: "proef", revision: "0", license: "-" }, analysis: "linear",
    displacements: model.nodes.map((node) => ({ nodeId: node.id, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })),
    reactions: [],
    memberForces: model.beams.map((beam, i) => ({
      memberId: beam.id, lengthM: 6, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
      torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: perStaaf[i][0].value, myEndKnm: perStaaf[i][perStaaf[i].length - 1].value,
      mzStartKnm: 0, mzEndKnm: 0,
    })),
    diagrams: {
      momentY: model.beams.map((beam, i) => ({
        memberId: beam.id, points: perStaaf[i], maxValue: Math.max(...perStaaf[i].map((p) => p.value)),
        minValue: Math.min(...perStaaf[i].map((p) => p.value)), maxAbsValue: Math.max(...perStaaf[i].map((p) => Math.abs(p.value))),
      })),
      momentZ: [], shearY: [], shearZ: [], axial: [], torsion: [],
    },
    buckling: { status: "unavailable", modes: [] }, diagnostics: [],
  } as unknown as OpenFem3DSolveResult;
};
// Groot model: 30 × 40 liggers van 6 m (6,5 m en 1,5 m h.o.h.), 1200 staven, met
// My = (k mod 17 + 1) · (4t(1 − t) − 0,25) in 11 punten: in stand 5 vijf labels
// per staaf (begin, eind, uiterste, kwartpunten 0,25 en 0,75), samen 6000.
const RASTER_STAVEN = 1200;
const rasterModel = parseOpenFem3DModel({
  nodes: Array.from({ length: RASTER_STAVEN }, (_, k) => {
    const x = 6.5 * (k % 30), y = 1.5 * Math.floor(k / 30);
    return [{ id: 2 * k + 1, x, y, z: 0 }, { id: 2 * k + 2, x: x + 6, y, z: 0 }];
  }).flat(),
  beams: Array.from({ length: RASTER_STAVEN }, (_, k) => ({ id: k + 1, startNodeId: 2 * k + 1, endNodeId: 2 * k + 2 })),
});
const rasterResultaat = myResultaat(rasterModel, (k) =>
  Array.from({ length: 11 }, (_, j) => ({ t: j / 10, value: (k % 17 + 1) * (4 * (j / 10) * (1 - j / 10) - 0.25) })));
/** De staaf met de grootste |My|: de eerste met k mod 17 = 16, staaf 17. */
const RASTER_MAATGEVEND = 17;
const myLabels = () => container.querySelectorAll<HTMLElement>(".open-fem3d-diagram-my");
const nLabels = () => container.querySelectorAll<HTMLElement>(".open-fem3d-member-force-label");
const waardenAan = (stand: OpenFem3DDiagramLabels["stand"]): OpenFem3DDiagramLabels => ({ show: true, stand });

async function waardenProeven() {
  await test("Waarden: aantal My-labels per stand 1 < 2 < 3 < 4 < 5; stand 3 = vóór #95 (45)", async () => {
    const aantallen: number[] = [];
    for (const stand of [1, 2, 3, 4, 5] as const) {
      await toon(rijModel, rijZicht, { result: rijResultaat, diagramLabels: waardenAan(stand) });
      aantallen.push(myLabels().length);
      const ds = tekenvlakEl().dataset;
      gelijk([ds.openFem3dDiagramLabels, ds.openFem3dDiagramLabelElements, ds.openFem3dDiagramLabelsThinned],
        [String(myLabels().length), String(myLabels().length), "false"], `diagnose stand ${stand}: plan = elementen, niet uitgedund`);
    }
    gelijk(aantallen, [1, 3, 45, 90, 150], "My-labels per stand");
    await toon(rijModel, rijZicht, { result: rijResultaat });
    gelijk(myLabels().length, 45, "zonder instelling: de standaard, stand 3 = het aantal van vóór #95");
    // Zonder opnieuw te mounten: alleen de labellaag wordt opnieuw opgebouwd.
    const opbouw = tekenvlakEl().dataset.openFem3dBuildMs;
    flushSync(() => zetWaarden(waardenAan(1)));
    await wacht();
    gelijk(myLabels().length, 1, "regelaar naar stand 1");
    gelijk(tekenvlakEl().dataset.openFem3dBuildMs, opbouw, "de scène zelf is niet opnieuw opgebouwd");
    const maatgevend = myLabels()[0].textContent ?? "";
    ok(/^My \+22\.50 kNm$/.test(maatgevend), `stand 1 toont de maatgevende waarde (staaf 30, midden): ${maatgevend}`);
    flushSync(() => zetWaarden(waardenAan(5)));
    await wacht();
    gelijk(myLabels().length, 150, "regelaar naar stand 5");
  });

  await test("Waarden uit: geen getallen bij de lijnen (ook N niet), de lijnen blijven", async () => {
    await toon(rijModel, { ...rijZicht, axialForce: true }, { result: rijResultaat, diagramLabels: waardenAan(3) });
    gelijk([myLabels().length, nLabels().length], [45, 15], "aan: My en N op de ingedeelde staven");
    gelijk(nLabels()[0].textContent, "N 1.00 kN", "N-label zoals vóór #95");
    gelijk(tekenvlakEl().dataset.openFem3dResultDiagrams, String(RIJ), "30 My-lijnen getekend");
    flushSync(() => zetWaarden({ show: false, stand: 3 }));
    await wacht();
    gelijk([myLabels().length, nLabels().length, container.querySelectorAll(".open-fem3d-diagram-label").length], [0, 0, 0], "uit: geen getallen");
    gelijk(tekenvlakEl().dataset.openFem3dDiagramLabels, "0", "diagnose");
    gelijk(tekenvlakEl().dataset.openFem3dResultDiagrams, String(RIJ), "de lijnen blijven");
    await toon(rijModel, { ...rijZicht, axialForce: true }, { result: rijResultaat, diagramLabels: { show: false, stand: 5 } });
    gelijk([myLabels().length, nLabels().length], [0, 0], "uit bij het opbouwen, ook in stand 5");
    flushSync(() => zetTekenvlakSelectie({ type: "beam", id: 2 }));
    await wacht();
    gelijk([myLabels().length, nLabels().length], [0, 0], "uit: ook een geselecteerde staaf geen getallen");
  });

  await test("Waarden: een geselecteerde staaf toont zijn waarden ook in stand 1; deselecteren haalt ze weg", async () => {
    await toon(rijModel, { ...rijZicht, axialForce: true }, { result: rijResultaat, diagramLabels: waardenAan(1) });
    const vanStaaf = (id: number) => container.querySelectorAll(`.open-fem3d-diagram-my[data-open-fem3d-beam="${id}"]`).length;
    gelijk([myLabels().length, vanStaaf(30), vanStaaf(2), nLabels().length], [1, 1, 0, 1], "stand 1: alleen de maatgevende waarden");
    flushSync(() => zetTekenvlakSelectie({ type: "beam", id: 2 }));
    await wacht();
    gelijk([myLabels().length, vanStaaf(30), vanStaaf(2)], [4, 1, 3], "staaf 2 geselecteerd: begin, eind en uiterste erbij");
    gelijk(container.querySelectorAll('.open-fem3d-member-force-label[data-open-fem3d-beam="2"]').length, 1, "en zijn N");
    flushSync(() => zetTekenvlakSelectie({ type: "multi", nodeIds: [], beamIds: [2, 3] }));
    await wacht();
    gelijk([vanStaaf(2), vanStaaf(3)], [3, 3], "meervoudige selectie");
    flushSync(() => zetTekenvlakSelectie(null));
    await wacht();
    gelijk([myLabels().length, vanStaaf(2)], [1, 0], "selectie weg: terug naar de maatgevende waarde");
  });

  await test("Waarden: in stand 5 valt geen zichtbaar label over de view cube of buiten het tekenvlak", async () => {
    // Dicht bovenaanzicht: de liggers vullen de rechterhelft, ook rechtsboven bij de kubus.
    await toon(rijModel, rijZicht, { result: rijResultaat, diagramLabels: waardenAan(5),
      camera: { position: [1, 30, 8], target: [1, 30, 0], up: [0, 1, 0] } });
    const kubus = container.querySelector(".open-fem3d-view-cube")?.getBoundingClientRect();
    ok(kubus && kubus.width > 0, "de view cube staat in beeld");
    const vlak = tekenvlakEl().getBoundingClientRect();
    const opKubus = (label: HTMLElement) => {
      const r = label.getBoundingClientRect();
      return r.left < kubus!.right && r.right > kubus!.left && r.top < kubus!.bottom && r.bottom > kubus!.top;
    };
    // Opzet: in stand 5 vallen er labels op de plek van de kubus (verborgen
    // labels houden hun rechthoek), dus de regel wordt echt op de proef gesteld.
    ok([...myLabels()].filter((label) => label.style.display !== "none").some(opKubus),
      "opzet: er liggen labels op de plek van de view cube");
    const zichtbaar = [...myLabels()].filter((label) => label.style.visibility !== "hidden" && label.style.display !== "none");
    ok(zichtbaar.length > 0, "er zijn zichtbare labels");
    gelijk(zichtbaar.filter(opKubus).length, 0, "geen label over de view cube");
    const buiten = zichtbaar.filter((label) => {
      const r = label.getBoundingClientRect();
      return r.right <= vlak.left || r.left >= vlak.right || r.bottom <= vlak.top || r.top >= vlak.bottom;
    });
    gelijk(buiten.length, 0, "geen zichtbaar label buiten het tekenvlak");
  });

  await test("verkenner Resultaten: het sub-blok Waarden alleen met een lijn aan, onder de eerste; vinkje en regelaar", async () => {
    let zicht: OpenFem3DVisibility = { ...rijZicht, momentY: false };
    let waarden: OpenFem3DDiagramLabels = { show: true, stand: 3 };
    let zetZicht: (next: OpenFem3DVisibility) => void = () => {};
    function Verkenner() {
      const [v, setV] = useState(zicht);
      const [w, setW] = useState(waarden);
      zetZicht = (next) => { zicht = next; setV(next); };
      return <div style={{ width: 280 }}><OpenFem3DExplorer model={rijModel} selection={null} setSelection={() => {}}
        result={rijResultaat} activeTab="results" setActiveTab={() => {}} visibility={v} setVisibility={zetZicht}
        diagramLabels={w} setDiagramLabels={(next) => { waarden = next; setW(next); }}
        displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} gridShow={false} setGridShow={() => {}}
        structuralGrid={DEFAULT_STRUCTURAL_GRID} setStructuralGridEnabled={() => {}} /></div>;
    }
    mount(<Verkenner />);
    await wacht();
    // Eigen markering: data-open-fem3d-diagram-labels is de teller van het tekenvlak.
    const blokken = () => [...container.querySelectorAll<HTMLElement>("[data-open-fem3d-diagram-label-controls]")];
    const laagVan = (blok: HTMLElement) => blok.closest<HTMLElement>("[data-open-fem3d-result-layer]")?.dataset.openFem3dResultLayer;
    gelijk(blokken().length, 0, "geen lijn aan: geen sub-blok");
    flushSync(() => zetZicht({ ...zicht, deformation: true, reactions: true }));
    await wacht();
    gelijk(blokken().length, 0, "vervorming en reacties: geen sub-blok");
    flushSync(() => zetZicht({ ...zicht, momentY: true }));
    await wacht();
    gelijk(blokken().map(laagVan), ["momentY"], "My aan: onder My");
    const rij = container.querySelector<HTMLElement>('[data-open-fem3d-result-layer="momentY"]')!;
    ok(rij.lastElementChild === blokken()[0], "direct onder de schakelaar van My");
    flushSync(() => zetZicht({ ...zicht, shearY: true }));
    await wacht();
    gelijk(blokken().map(laagVan), ["shearY"], "Vy en My aan: alleen onder Vy (de eerste)");
    flushSync(() => zetZicht({ ...zicht, axialForce: true }));
    await wacht();
    gelijk(blokken().map(laagVan), ["axialForce"], "N telt mee");
    const blok = blokken()[0];
    ok(/Waarden/.test(blok.textContent ?? "") && /Weinig/.test(blok.textContent ?? "") && /Veel/.test(blok.textContent ?? ""),
      `teksten Waarden, Weinig, Veel: ${blok.textContent}`);
    const vinkje = blok.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    const regelaar = blok.querySelector<HTMLInputElement>("input[type=range]")!;
    gelijk([vinkje.checked, regelaar.value, regelaar.min, regelaar.max, regelaar.disabled], [true, "3", "1", "5", false], "begintoestand");
    ok(vinkje.getAttribute("aria-label") && regelaar.getAttribute("aria-label") && regelaar.getAttribute("aria-valuetext"),
      "toegankelijke namen");
    const zet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const schuif = (waarde: string) => {
      const el = blokken()[0].querySelector<HTMLInputElement>("input[type=range]")!;
      flushSync(() => { zet.call(el, waarde); el.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    schuif("1");
    await wacht();
    gelijk(waarden, { show: true, stand: 1 }, "regelaar naar Weinig");
    schuif("5");
    await wacht();
    gelijk(waarden, { show: true, stand: 5 }, "regelaar naar Veel");
    flushSync(() => blokken()[0].querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    await wacht();
    gelijk(waarden, { show: false, stand: 5 }, "Waarden uit");
    ok(blokken()[0].querySelector<HTMLInputElement>("input[type=range]")!.disabled, "zonder Waarden is de regelaar uitgeschakeld");
    flushSync(() => zetZicht({ ...zicht, axialForce: false, shearY: false, momentY: false }));
    await wacht();
    gelijk(blokken().length, 0, "alle lijnen uit: sub-blok weg");
  });

  await test("verkenner Resultaten op 240 px (beginbreedte van het paneel): Waarden en Vervormde vorm passen in de rij, nl en fr", async () => {
    const zicht: OpenFem3DVisibility = { ...rijZicht, deformation: true, momentY: true };
    try {
      for (const taal of ["nl", "fr"]) {
        await i18next.changeLanguage(taal);
        mount(<div style={{ width: 240 }} data-proef-paneel><OpenFem3DExplorer model={rijModel} selection={null} setSelection={() => {}}
          result={rijResultaat} activeTab="results" setActiveTab={() => {}} visibility={zicht} setVisibility={() => {}}
          setDeformationDisplay={() => {}} diagramLabels={{ show: true, stand: 3 }} setDiagramLabels={() => {}}
          displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} gridShow={false} setGridShow={() => {}}
          structuralGrid={DEFAULT_STRUCTURAL_GRID} setStructuralGridEnabled={() => {}} /></div>);
        await wacht();
        const paneel = container.querySelector<HTMLElement>("[data-proef-paneel]")!.getBoundingClientRect();
        const rijen = [...container.querySelectorAll<HTMLElement>("[data-open-fem3d-diagram-label-controls], [data-open-fem3d-deformation-scale]")];
        gelijk(rijen.length, 2, `${taal}, opzet: het sub-blok Waarden en de vergroting onder Vervormde vorm`);
        for (const rij of rijen) {
          const r = rij.getBoundingClientRect();
          ok(r.right <= paneel.right + 0.5, `${taal} 240 px: de rij eindigt op ${r.right.toFixed(1)}, het paneel op ${paneel.right.toFixed(1)}`);
          for (const kind of [...rij.children] as HTMLElement[]) {
            const k = kind.getBoundingClientRect();
            ok(k.right <= r.right + 0.5, `${taal} 240 px: "${kind.textContent}" eindigt op ${k.right.toFixed(1)}, de rij op ${r.right.toFixed(1)}`);
          }
          const regelaar = rij.querySelector<HTMLElement>("input[type=range]")!.getBoundingClientRect();
          ok(regelaar.width >= 24, `${taal} 240 px: de regelaar blijft te bedienen (${regelaar.width.toFixed(0)} px)`);
          ok(rij.scrollWidth <= rij.clientWidth, `${taal} 240 px: de rij loopt over (${rij.scrollWidth} > ${rij.clientWidth})`);
        }
      }
    } finally {
      await i18next.changeLanguage("nl");
    }
  });

  await test("Waarden stand 5: de kwartpunten komen in beeld (niet verborgen achter begin en eind); stand 5 toont meer dan stand 4", async () => {
    // Eén ligger van 6 m, My = 180 t (1 − t) in 21 punten (45 in het midden,
    // 33,75 op de kwartpunten), in vooraanzicht passend in beeld.
    const ligger = parseOpenFem3DModel({
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }],
    });
    const resultaat = myResultaat(ligger, () => Array.from({ length: 21 }, (_, k) => ({ t: k / 20, value: 180 * (k / 20) * (1 - k / 20) })));
    const zichtbaar = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)]
      .filter((label) => label.style.visibility !== "hidden" && label.style.display !== "none");
    const telling: Record<number, number> = {};
    for (const stand of [4, 5] as const) {
      await toon(ligger, rijZicht, { result: resultaat, diagramLabels: waardenAan(stand), viewRequest: { kind: "front", token: 1 } });
      telling[stand] = zichtbaar(".open-fem3d-diagram-my").length;
    }
    const kwart = zichtbaar(".open-fem3d-diagram-quarter-label");
    gelijk(container.querySelectorAll(".open-fem3d-diagram-quarter-label").length, 2, "opzet: twee kwartlabels (0,25 en 0,75; 0,5 is het uiterste)");
    ok(kwart.length >= 1, `geen enkel kwartlabel zichtbaar (stand 5: ${telling[5]} zichtbaar, stand 4: ${telling[4]})`);
    ok(kwart.every((label) => label.textContent === "My +33.75 kNm"), `kwartwaarde: ${kwart.map((label) => label.textContent).join(", ")}`);
    ok(telling[5] > telling[4], `stand 5 toont niet meer dan stand 4: ${telling[5]} tegen ${telling[4]} zichtbare labels`);
    // Uitwijken gebeurt met een verschuiving, niet over een ander label heen.
    const rechthoeken = zichtbaar(".open-fem3d-diagram-my").map((label) => label.getBoundingClientRect());
    const overlap = rechthoeken.some((a, i) => rechthoeken.some((b, j) => j > i
      && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
    ok(!overlap, "zichtbare labels liggen niet over elkaar");
  });

  await test("Waarden via de editor: OpenFem3DEditor geeft de instelling door aan het tekenvlak (stand 1, 3, 5 en zonder instelling)", async () => {
    for (const [stand, verwacht] of [[1, 1], [3, 45], [5, 150], [undefined, 45]] as const) {
      mount(<div style={{ width: BREED, height: HOOG, display: "flex" }}>
        <OpenFem3DEditor model={rijModel} onChange={() => {}} visibility={rijZicht} onVisibilityChange={() => {}}
          result={rijResultaat} resultsActive diagramLabels={stand === undefined ? undefined : waardenAan(stand)} />
      </div>);
      await wacht(250);
      gelijk(myLabels().length, verwacht, `My-labels in de editor, stand ${stand ?? "standaard"}`);
    }
  });

  await test("Waarden groot model (1200 staven, stand 5): alleen wat in beeld past wordt een element; inzoomen, selectie en maatgevende waarde", async () => {
    await toon(rasterModel, rijZicht, { result: rasterResultaat, diagramLabels: waardenAan(5) });
    const ds = () => tekenvlakEl().dataset;
    gelijk([ds().openFem3dDiagramLabels, ds().openFem3dDiagramLabelsThinned], [String(RASTER_STAVEN * 5), "true"],
      "plan: 5 labels per staaf, uitgedund");
    const elementen = () => myLabels().length;
    const zichtbaar = () => [...myLabels()].filter((label) => label.style.visibility !== "hidden" && label.style.display !== "none");
    gelijk(String(elementen()), ds().openFem3dDiagramLabelElements, "diagnose: elementen in de DOM");
    ok(elementen() <= 600, `te veel elementen voor één beeld: ${elementen()} van ${RASTER_STAVEN * 5}`);
    ok(zichtbaar().length >= 10, `te weinig zichtbare labels: ${zichtbaar().length}`);
    ok(zichtbaar().length >= elementen() * 0.4, `de schatting zet vooral labels neer die niet passen: ${zichtbaar().length} zichtbaar van ${elementen()}`);
    const vanStaaf = (id: number) => container.querySelectorAll(`.open-fem3d-diagram-my[data-open-fem3d-beam="${id}"]`).length;
    gelijk(vanStaaf(RASTER_MAATGEVEND), 5, "de maatgevende staaf houdt al zijn labels als element");
    // Inzoomen op de hoek met staaf 1: daar komen de labels als element bij.
    zetTekenvlakCamera({ position: [3, 0.75, 9], target: [3, 0.75, 0], up: [0, 1, 0] });
    await wacht();
    ok(vanStaaf(1) === 5, `ingezoomd: staaf 1 heeft ${vanStaaf(1)} van 5 labels als element`);
    ok(zichtbaar().some((label) => label.dataset.openFem3dBeam === "1"), "ingezoomd: een label van staaf 1 is zichtbaar");
    ok(elementen() <= 600, `ingezoomd: ${elementen()} elementen`);
    gelijk(String(elementen()), ds().openFem3dDiagramLabelElements, "ingezoomd: diagnose");
    // Een geselecteerde staaf buiten beeld: zijn labels staan er als element; weg na deselecteren.
    const ver = RASTER_STAVEN;
    gelijk(vanStaaf(ver), 0, "opzet: de verste staaf staat buiten beeld, zonder elementen");
    const opbouw = ds().openFem3dBuildMs;
    flushSync(() => zetTekenvlakSelectie({ type: "beam", id: ver }));
    await wacht();
    gelijk(vanStaaf(ver), 5, "geselecteerd: alle vijf labels als element");
    gelijk(ds().openFem3dBuildMs, opbouw, "de scène zelf is niet opnieuw opgebouwd");
    flushSync(() => zetTekenvlakSelectie(null));
    await wacht();
    gelijk(vanStaaf(ver), 0, "selectie weg: de elementen ook");
    ok(vanStaaf(1) === 5, "staaf 1 (in beeld) houdt zijn labels");
  });
}

// ── Een lijnlast kiezen (issue #81, groep "lijnlast") ─────────────────────
// Twee liggers van 6 m op z = 3 langs de x-as: last 5 (gelijkmatig 2 kN/m)
// over heel ligger 1 (x 0–6 m), last 6 (trapezium 2 → 1 kN/m) over een deel
// van ligger 2 (1,5–4,5 m, dus x 11,5–14,5). De pijlen zoals
// openFem3dMarkers.ts ze tekent: om de 0,75 m (negen voor last 5, vijf voor
// last 6), de punt op de staafas, de staart (0,9 + 0,9·|q|/qmax) maat erboven
// en de staartlijn door de staarten.
const LIJNLAST_Z = 3;
const lijnlastBasis = {
  nodes: [
    { id: 1, x: 0, y: 0, z: LIJNLAST_Z }, { id: 2, x: 6, y: 0, z: LIJNLAST_Z },
    { id: 3, x: 10, y: 0, z: LIJNLAST_Z }, { id: 4, x: 16, y: 0, z: LIJNLAST_Z },
  ],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }],
  memberLoads: [
    { id: 5, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2, startPositionM: 0, endPositionM: 6 },
    { id: 6, beamId: 2, qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -1, startPositionM: 1.5, endPositionM: 4.5 },
  ],
};
// Per pijl: x van de punt en de pijllengte in maten.
const LIJNLASTEN = [
  { id: 5, beamId: 1, naam: "hele ligger, gelijkmatig",
    pijlen: Array.from({ length: 9 }, (_, k) => ({ x: 0.75 * k, lengte: 1.8 })) },
  { id: 6, beamId: 2, naam: "deel van de ligger, trapezium",
    pijlen: Array.from({ length: 5 }, (_, k) => ({ x: 11.5 + 0.75 * k, lengte: 0.9 + 0.9 * (2 - k / 4) / 2 })) },
];
const LIJNLAST_KLEUR = 0xef4444;
const scharnier = { ux: true, uy: true, uz: true, rx: false, ry: false, rz: false };
const LIJNLAST_MODELLEN = [
  // Twee lasten, geen opleggingen: minder dan vier markeringen, dus losse pijlen.
  { naam: "klein zonder batches", batches: false, model: parseOpenFem3DModel(lijnlastBasis) },
  // Twee opleggingen erbij: vier markeringen, dus pijlen in GPU-batches.
  { naam: "klein met batches", batches: true, model: parseOpenFem3DModel({
    ...lijnlastBasis, supports: [{ nodeId: 1, ...scharnier }, { nodeId: 2, ...scharnier }],
  }) },
  // Idem met 118 staven ver erachter (z = 0, y ≥ 20, in perspectief boven de
  // pijlen in beeld): 120 staven, ook de staven in batches.
  { naam: "groot (120 staven)", batches: true, model: parseOpenFem3DModel({
    ...lijnlastBasis,
    supports: [{ nodeId: 1, ...scharnier }, { nodeId: 2, ...scharnier }],
    nodes: [...lijnlastBasis.nodes, ...Array.from({ length: 118 }, (_, k) => {
      const x = 6.5 * (k % 10) - 24, y = 20 + 4 * Math.floor(k / 10);
      return [{ id: 5 + 2 * k, x, y, z: 0 }, { id: 6 + 2 * k, x: x + 6, y, z: 0 }];
    }).flat()],
    beams: [...lijnlastBasis.beams, ...Array.from({ length: 118 }, (_, k) => ({ id: 3 + k, startNodeId: 5 + 2 * k, endNodeId: 6 + 2 * k }))],
  }) },
];
const lijnlastCamera: OpenFem3DCameraState = { position: [13, -14, 9], target: [8, 0, 3], up: [0, 0, 1] };
const SELECTIEKLEUR = 0xffa31a;
/**
 * Hoeveel getekende delen van last `type` `id` (pijlsteel, pijlpunt,
 * staartlijn, ring; los of als instantie in een GPU-batch) de selectiekleur
 * hebben, uit de scène die het tekenvlak het laatst tekende. `ongemarkeerd`
 * telt de overige delen per soort (object/geometrie), `batchGemarkeerd` noemt
 * de gemarkeerde instanties per batch (geometrie#index) en `kleuren` geeft de
 * kleur van elk deel in vaste volgorde (om na deselecteren te vergelijken).
 * Met batches delen de staartlijnen van alle lijnlasten één lijnobject met
 * een kleur per lijnstuk; de lijnstukken van één last tellen samen als één
 * deel, zoals de losse staartlijn zonder batches.
 */
function lastMarkering(type: string, id: number) {
  ok(renderScene, "er is getekend");
  let delen = 0, gemarkeerd = 0;
  const ongemarkeerd: Record<string, number> = {};
  const batchGemarkeerd: string[] = [];
  const kleuren: number[] = [];
  const kleur = new THREE.Color();
  renderScene!.traverse((object) => {
    if (object.userData.type !== type || !object.visible) return;
    if (object instanceof THREE.LineSegments && Array.isArray(object.userData.segmentIds)) {
      const kleurAttribuut = object.geometry.getAttribute("color");
      const eigen: number[] = [];
      (object.userData.segmentIds as number[]).forEach((segmentId, index) => {
        if (segmentId !== id) return;
        // Beide eindpunten van het lijnstuk.
        for (const punt of [2 * index, 2 * index + 1]) eigen.push(kleur.fromBufferAttribute(kleurAttribuut, punt).getHex());
      });
      if (eigen.length === 0) return;
      delen += 1;
      kleuren.push(...new Set(eigen));
      if (eigen.every((k) => k === SELECTIEKLEUR)) gemarkeerd += 1;
      else ongemarkeerd["gedeelde staartlijn"] = (ongemarkeerd["gedeelde staartlijn"] ?? 0) + 1;
      return;
    }
    if (object instanceof THREE.InstancedMesh && Array.isArray(object.userData.instanceIds)) {
      (object.userData.instanceIds as number[]).forEach((instanceId, index) => {
        if (instanceId !== id) return;
        delen += 1;
        object.getColorAt(index, kleur);
        kleuren.push(kleur.getHex());
        const soort = `batch ${object.geometry.type}`;
        if (kleur.getHex() === SELECTIEKLEUR) { gemarkeerd += 1; batchGemarkeerd.push(`${object.geometry.type}#${index}`); }
        else ongemarkeerd[soort] = (ongemarkeerd[soort] ?? 0) + 1;
      });
      return;
    }
    if (object.userData.id !== id) return;
    const drawable = object as THREE.Mesh;
    const material = drawable.material as (THREE.Material & { color?: THREE.Color }) | undefined;
    if (!material || Array.isArray(material) || !material.color) return;
    delen += 1;
    kleuren.push(material.color.getHex());
    const soort = `${object.type} ${drawable.geometry?.type ?? ""}`.trim();
    if (material.color.getHex() === SELECTIEKLEUR) gemarkeerd += 1;
    else ongemarkeerd[soort] = (ongemarkeerd[soort] ?? 0) + 1;
  });
  return { delen, gemarkeerd, ongemarkeerd, batchGemarkeerd, kleuren };
}
/** Het aantal GPU-batches (InstancedMesh) voor tekens van soort `type` in de laatst getekende scène. */
function batchesVan(type: string) {
  let aantal = 0;
  renderScene?.traverse((object) => { if (object instanceof THREE.InstancedMesh && object.userData.type === type) aantal += 1; });
  return aantal;
}
/**
 * De getekende objecten van alle lasten (uuid's) in de laatst getekende scène.
 * Selecteren kleurt alleen; bouwt het tekenvlak bij een klik de scène opnieuw
 * op, dan veranderen ze, en dan toetst een kleur na wisselen of deselecteren
 * het terugzetten van de kleur niet meer (nieuwe objecten zijn altijd in hun
 * eigen kleur).
 */
function lastObjecten() {
  const uuids: string[] = [];
  renderScene?.traverse((object) => {
    if (["nodalLoad", "memberLoad", "memberPointLoad", "thermalLoad"].includes(object.userData.type)) uuids.push(object.uuid);
  });
  return uuids.sort().join(" ");
}
const markeringTekst = (m: ReturnType<typeof lastMarkering>) => `${m.gemarkeerd} van ${m.delen} delen gemarkeerd`
  + (Object.keys(m.ongemarkeerd).length ? `, niet: ${JSON.stringify(m.ongemarkeerd)}` : "")
  + (m.batchGemarkeerd.length ? `, in batches alleen ${m.batchGemarkeerd.join(" ")}` : "");
const heelGemarkeerd = (m: ReturnType<typeof lastMarkering>) => m.delen > 0 && m.gemarkeerd === m.delen;
const kleurenTekst = (kleuren: number[]) => [...new Set(kleuren)].map((k) => `#${k.toString(16).padStart(6, "0")}`).join(" ");
const selectieTekst = (s: OpenFem3DSelection) => s ? `${s.type} ${"id" in s ? s.id : ""}` : "niets";
/** Selectie weg via de toestand van het tekenvlak, zoals Escape of een klik in het niets. */
async function geenSelectie() {
  flushSync(() => zetTekenvlakSelectie(null));
  await wacht();
  selectie = null;
}

async function lijnlastProeven() {
  for (const opzet of LIJNLAST_MODELLEN) {
    for (const perspectief of [true, false]) {
      const stand = perspectief ? "perspectief" : "parallel";
      await test(`lijnlast (#81), ${opzet.naam}, ${stand}: een klik op elke pijl, op de pijlpunt vlak boven de staaf en op de staartlijn selecteert de hele last en markeert al zijn pijlen en zijn staartlijn; wisselen en deselecteren zetten de eigen kleuren terug`, async () => {
        const zicht: OpenFem3DVisibility = { ...snel, perspective: perspectief };
        await toon(opzet.model, zicht, { camera: lijnlastCamera });
        gelijk(diag().openFem3dProjection, perspectief ? "perspective" : "orthographic", "opzet: projectie");
        gelijk(batchesVan("memberLoad") > 0, opzet.batches, "opzet: pijlen in GPU-batches");
        gelijk(batchesVan("beam") > 0, opzet.model.beams.length >= 100, "opzet: staven in GPU-batches");
        // Ongeselecteerd: elk deel in de lastkleur. Per pijl een steel en een
        // punt, plus de staartlijn: 2n + 1 delen, los en in batches.
        const verwachteDelen = (last: typeof LIJNLASTEN[number]) => 2 * last.pijlen.length + 1;
        const basis = new Map(LIJNLASTEN.map((last) => [last.id, lastMarkering("memberLoad", last.id)]));
        for (const last of LIJNLASTEN) {
          gelijk(basis.get(last.id)!.delen, verwachteDelen(last), `opzet: last ${last.id} in ${verwachteDelen(last)} delen (per pijl steel en punt, plus de staartlijn)`);
          gelijk(kleurenTekst(basis.get(last.id)!.kleuren), kleurenTekst([LIJNLAST_KLEUR]), `opzet: last ${last.id} ongeselecteerd in de lastkleur`);
        }
        // Selecteren kleurt alleen: de lastobjecten blijven dezelfde.
        const objecten = lastObjecten();
        const herbouwd: string[] = [];
        const cam = camera();
        const maat = openFem3DConditionMarkerSize(opzet.model.nodes);
        const knopen = new Map(opzet.model.nodes.map((n) => [n.id, n]));
        const lijnen = opzet.model.beams.map((b) => ({ id: b.id, a: scherm(cam, knopen.get(b.startNodeId)!), e: scherm(cam, knopen.get(b.endNodeId)!) }));
        const at = (x: number, hoogte: number) => scherm(cam, { x, y: 0, z: LIJNLAST_Z + hoogte });
        const steel = (pijl: { x: number; lengte: number }) => at(pijl.x, 0.55 * pijl.lengte * maat);
        const middelste = (last: typeof LIJNLASTEN[number]) => last.pijlen[Math.floor(last.pijlen.length / 2)];
        const missers: string[] = [];
        const onvolledig: string[] = [];
        for (const last of LIJNLASTEN) {
          const anderId = LIJNLASTEN.find((ander) => ander.id !== last.id)!.id;
          const n = last.pijlen.length;
          const m = Math.floor(n / 2);
          // Midden tussen twee staarten: daar ligt de staartlijn.
          const staart = (k: number) => {
            const a = last.pijlen[k], b = last.pijlen[k + 1];
            return at((a.x + b.x) / 2, (a.lengte + b.lengte) / 2 * maat);
          };
          const klikken: { naam: string; p: Pt; staafMagDichtbij?: boolean }[] = [
            ...last.pijlen.map((pijl, k) => ({ naam: `pijl ${k + 1}/${n}, midden van de steel`, p: steel(pijl) })),
            // De pijlpunt is 0,36 maat lang; 0,18 maat boven de staafas ligt erin.
            { naam: `middelste pijl, op de pijlpunt vlak boven de staaf`, p: at(last.pijlen[m].x, 0.18 * maat), staafMagDichtbij: true },
            { naam: "staartlijn tussen pijl 1 en 2", p: staart(0) },
            { naam: `staartlijn tussen pijl ${m + 1} en ${m + 2}`, p: staart(m) },
          ];
          for (const k of klikken) {
            ok(binnenBeeld(k.p), `opzet: ${k.naam} (last ${last.id}) ligt in beeld`);
            // Eenduidig: geen andere staaf binnen 10 px; de eigen staaf alleen bij de pijlpunt.
            const dichtbij = lijnen.filter((l) => (l.id !== last.beamId || !k.staafMagDichtbij) && afstandTotLijnstuk(k.p, l.a, l.e) < 10);
            gelijk(dichtbij.map((l) => l.id), [], `opzet: geen staaf binnen 10 px van ${k.naam} (last ${last.id})`);
            await geenSelectie();
            klik(k.p);
            await wacht();
            const s = selectie as OpenFem3DSelection;
            const d = diag();
            if (!(s?.type === "memberLoad" && s.id === last.id)) {
              missers.push(`last ${last.id} (${last.naam}) ${k.naam} → ${selectieTekst(s)}`
                + ` [keuze ${d.openFem3dPickReason}; straal ${d.openFem3dPickCandidates || "-"}; staaflijn ${d.openFem3dPickBeamScreen}]`);
              continue;
            }
            if (lastObjecten() !== objecten) herbouwd.push(`last ${last.id} ${k.naam} (bouwmodus ${d.openFem3dBuildMode})`);
            const eigen = lastMarkering("memberLoad", last.id);
            const ander = lastMarkering("memberLoad", anderId);
            if (!heelGemarkeerd(eigen) || eigen.delen !== verwachteDelen(last) || ander.gemarkeerd !== 0) {
              onvolledig.push(`last ${last.id} ${k.naam}: ${markeringTekst(eigen)}`
                + (eigen.delen !== verwachteDelen(last) ? ` (verwacht ${verwachteDelen(last)} delen)` : "")
                + (ander.gemarkeerd ? `; van last ${anderId} ten onrechte ${ander.gemarkeerd}` : ""));
            }
          }
        }
        gelijk({ missers, onvolledig }, { missers: [], onvolledig: [] }, `${missers.length} klikken kozen iets anders, ${onvolledig.length} keer een onvolledige markering`);
        gelijk(herbouwd, [], `${herbouwd.length} klikken bouwden de scène opnieuw op in plaats van alleen te kleuren`);

        // Rechtstreeks van last 5 naar last 6 (klik op de middelste pijl) en daarna niets geselecteerd.
        const [eerste, tweede] = LIJNLASTEN;
        await geenSelectie();
        for (const last of [eerste, tweede]) {
          klik(steel(middelste(last)));
          await wacht();
          const s = selectie as OpenFem3DSelection;
          gelijk(selectieTekst(s), `memberLoad ${last.id}`, `wisselen: klik op de middelste pijl van last ${last.id}`);
          const eigen = lastMarkering("memberLoad", last.id);
          ok(heelGemarkeerd(eigen) && eigen.delen === verwachteDelen(last), `wisselen: last ${last.id} geheel gemarkeerd: ${markeringTekst(eigen)}`);
        }
        gelijk(lastMarkering("memberLoad", eerste.id).kleuren, basis.get(eerste.id)!.kleuren, `wisselen: last ${eerste.id} terug in zijn eigen kleuren`);
        await geenSelectie();
        for (const last of LIJNLASTEN) {
          gelijk(lastMarkering("memberLoad", last.id).kleuren, basis.get(last.id)!.kleuren, `deselecteren: last ${last.id} terug in zijn eigen kleuren`);
        }
        gelijk(lastObjecten() === objecten, true, `wisselen en deselecteren bouwden de scène niet opnieuw op (bouwmodus ${diag().openFem3dBuildMode})`);
      });
    }
  }

  // Een puntlast op ligger 1 (x = 3 m, pijl zoals een lijnlastpijl), een
  // temperatuurlast op ligger 2 (ring om het staafmidden x = 13 m, twee
  // pijlen langs de as en een gele gradiëntring) en een knooplast op knoop 2
  // (x = 6 m): kracht in y en z (elk steel en punt) en een moment om x (boog
  // en punt). Zonder opleggingen drie markeringen (los getekend), met twee
  // opleggingen vijf (in GPU-batches).
  const puntTemperatuurKnoop = {
    nodes: lijnlastBasis.nodes, beams: lijnlastBasis.beams,
    loads: [{ id: 10, nodeId: 2, fx: 0, fy: 3, fz: -4, mx: 2, my: 0, mz: 0 }],
    memberPointLoads: [{ id: 8, beamId: 1, py: 0, pz: -5, positionM: 3 }],
    thermalLoads: [{ id: 9, beamId: 2, deltaTUniformK: 20, deltaTGradientYK: 0, deltaTGradientZK: 5 }],
  };
  for (const [naam, model] of [
    ["zonder batches", parseOpenFem3DModel(puntTemperatuurKnoop)],
    ["met batches", parseOpenFem3DModel({ ...puntTemperatuurKnoop, supports: [{ nodeId: 1, ...scharnier }, { nodeId: 2, ...scharnier }] })],
  ] as const) {
    await test(`puntlast, temperatuurlast en knooplast (#81), ${naam}: een klik selecteert de last en markeert al zijn delen; deselecteren zet de eigen kleuren terug`, async () => {
      await toon(model, { ...snel }, { camera: lijnlastCamera });
      const batches = naam === "met batches";
      gelijk(batchesVan("memberPointLoad") > 0, batches, "opzet: puntlastpijl in een GPU-batch");
      gelijk(batchesVan("nodalLoad") > 0, batches, "opzet: knooplast in GPU-batches");
      const cam = camera();
      const maat = openFem3DConditionMarkerSize(model.nodes);
      const lasten = [
        // Puntlast: midden van de steel (pijl 1,8 maat, punt 0,36 maat).
        ["memberPointLoad", 8, scherm(cam, { x: 3, y: 0, z: LIJNLAST_Z + 0.99 * maat })],
        // Temperatuurlast: bovenkant van de ring (straal 0,62 maat).
        ["thermalLoad", 9, scherm(cam, { x: 13, y: 0, z: LIJNLAST_Z + 0.62 * maat })],
        // Knooplast: midden van de steel van de kracht in z (omlaag, punt op 0,35 maat boven de knoop).
        ["nodalLoad", 10, scherm(cam, { x: 6, y: 0, z: LIJNLAST_Z + 1.13 * maat })],
      ] as const;
      const basis = new Map(lasten.map(([type, id]) => [`${type} ${id}`, lastMarkering(type, id)]));
      const verwachteDelen: Record<string, number> = {
        // Steel en punt.
        "memberPointLoad 8": 2,
        // Ring, twee pijlen (elk steel en punt) en de gradiëntring.
        "thermalLoad 9": 6,
        // Twee krachten en een moment, elk twee.
        "nodalLoad 10": 6,
      };
      for (const [type, id] of lasten) {
        gelijk(basis.get(`${type} ${id}`)!.delen, verwachteDelen[`${type} ${id}`], `opzet: ${type} ${id} in ${verwachteDelen[`${type} ${id}`]} delen`);
      }
      ok(basis.get("thermalLoad 9")!.kleuren.includes(0xfacc15), "opzet: de gele gradiëntring telt mee");
      // Selecteren kleurt alleen: de lastobjecten blijven dezelfde.
      const objecten = lastObjecten();
      const fouten: string[] = [];
      for (const [type, id, p] of lasten) {
        await geenSelectie();
        klik(p);
        await wacht();
        const s = selectie as OpenFem3DSelection;
        if (!(s?.type === type && s.id === id)) {
          fouten.push(`${type} ${id}: klik koos ${selectieTekst(s)} [keuze ${diag().openFem3dPickReason}]`);
          continue;
        }
        if (lastObjecten() !== objecten) fouten.push(`${type} ${id}: de klik bouwde de scène opnieuw op (bouwmodus ${diag().openFem3dBuildMode})`);
        const m = lastMarkering(type, id);
        if (!heelGemarkeerd(m) || m.delen !== verwachteDelen[`${type} ${id}`]) fouten.push(`${type} ${id}: ${markeringTekst(m)}`);
        for (const [anderType, anderId] of lasten) {
          if (anderType === type) continue;
          const ander = lastMarkering(anderType, anderId);
          if (ander.gemarkeerd) fouten.push(`${type} ${id} geselecteerd: van ${anderType} ${anderId} ten onrechte ${ander.gemarkeerd}`);
        }
      }
      gelijk(fouten, [], "puntlast, temperatuurlast en knooplast");
      await geenSelectie();
      for (const [type, id] of lasten) {
        gelijk(lastMarkering(type, id).kleuren, basis.get(`${type} ${id}`)!.kleuren, `deselecteren: ${type} ${id} terug in zijn eigen kleuren`);
      }
      gelijk(lastObjecten() === objecten, true, `deselecteren bouwde de scène niet opnieuw op (bouwmodus ${diag().openFem3dBuildMode})`);
    });
  }

  // Een groepsselectie met lasten (selectiefilter, issue #94): elke last in de
  // groep geheel gemarkeerd, los en in GPU-batches; uit de groep gehaald of
  // gedeselecteerd weer in zijn eigen kleuren, zonder de scène op te bouwen.
  for (const opzet of LIJNLAST_MODELLEN.slice(0, 2)) {
    await test(`groepsselectie met lasten (#94), ${opzet.naam}: beide lijnlasten gemarkeerd; uit de groep of deselecteren zet de eigen kleuren terug`, async () => {
      await toon(opzet.model, { ...snel }, { camera: lijnlastCamera });
      const basis = new Map(LIJNLASTEN.map((last) => [last.id, lastMarkering("memberLoad", last.id)]));
      const objecten = lastObjecten();
      flushSync(() => zetTekenvlakSelectie({ type: "multi", nodeIds: [], beamIds: [], loads: { memberLoad: [5, 6] } }));
      await wacht();
      for (const last of LIJNLASTEN) {
        const m = lastMarkering("memberLoad", last.id);
        ok(heelGemarkeerd(m) && m.delen === 2 * last.pijlen.length + 1, `groep: last ${last.id} ${markeringTekst(m)}`);
      }
      gelijk(lastObjecten() === objecten, true, `de groep kleurt alleen (bouwmodus ${diag().openFem3dBuildMode})`);
      flushSync(() => zetTekenvlakSelectie({ type: "multi", nodeIds: [], beamIds: [1], loads: { memberLoad: [6] } }));
      await wacht();
      gelijk(lastMarkering("memberLoad", 5).kleuren, basis.get(5)!.kleuren, "last 5 uit de groep: terug in zijn eigen kleuren");
      ok(heelGemarkeerd(lastMarkering("memberLoad", 6)), `last 6 blijft gemarkeerd: ${markeringTekst(lastMarkering("memberLoad", 6))}`);
      await geenSelectie();
      for (const last of LIJNLASTEN) {
        gelijk(lastMarkering("memberLoad", last.id).kleuren, basis.get(last.id)!.kleuren, `deselecteren: last ${last.id} terug in zijn eigen kleuren`);
      }
    });
  }
}

// ── Scharnieren aan staafeinden en het inklemmingsteken (#93, groep "scharnier") ──
// Een portaal van 6 × 4 m: kolommen 1 (1→2) en 2 (3→4), ligger 3 (2→4) en
// inklemmingen aan de kolomvoeten. Met een tweede veld (kolom 4, ligger 5)
// zijn er vier scharnieren: de bolletjes in een GPU-batch.
const INKLEMMING = OPEN_FEM_3D_SUPPORT_PRESETS.fixed;
const scharnierBasis = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 4 }, { id: 3, x: 6, y: 0, z: 0 }, { id: 4, x: 6, y: 0, z: 4 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }, { id: 2, startNodeId: 3, endNodeId: 4 }, { id: 3, startNodeId: 2, endNodeId: 4 }],
  supports: [{ nodeId: 1, ...INKLEMMING }, { nodeId: 3, ...INKLEMMING }],
};
const scharnierVrij = parseOpenFem3DModel(scharnierBasis);
const scharnierPortaal = pinOpenFem3DBeamsToColumns(scharnierVrij).model;
const scharnierTweeVelden = pinOpenFem3DBeamsToColumns(parseOpenFem3DModel({
  nodes: [...scharnierBasis.nodes, { id: 5, x: 12, y: 0, z: 0 }, { id: 6, x: 12, y: 0, z: 4 }],
  beams: [...scharnierBasis.beams, { id: 4, startNodeId: 5, endNodeId: 6 }, { id: 5, startNodeId: 4, endNodeId: 6 }],
  supports: [...scharnierBasis.supports, { nodeId: 5, ...INKLEMMING }],
})).model;
// Vier kolommen van 3 m met elk een inklemming: de tekens in GPU-batches.
const vierInklemmingen = parseOpenFem3DModel({
  nodes: [0, 3, 6, 9].flatMap((x, k) => [{ id: 2 * k + 1, x, y: 0, z: 0 }, { id: 2 * k + 2, x, y: 0, z: 3 }]),
  beams: [0, 1, 2, 3].map((k) => ({ id: k + 1, startNodeId: 2 * k + 1, endNodeId: 2 * k + 2 })),
  supports: [1, 3, 5, 7].map((nodeId) => ({ nodeId, ...INKLEMMING })),
});
// Inklemming, scharnier en rol naast elkaar, elk onder een korte kolom.
const opleggingenNaastElkaar = parseOpenFem3DModel({
  nodes: [0, 1.6, 3.2].flatMap((x, k) => [{ id: 2 * k + 1, x, y: 0, z: 0 }, { id: 2 * k + 2, x, y: 0, z: 1.2 }]),
  beams: [0, 1, 2].map((k) => ({ id: k + 1, startNodeId: 2 * k + 1, endNodeId: 2 * k + 2 })),
  supports: [
    { nodeId: 1, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed }, { nodeId: 3, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned },
    { nodeId: 5, ...OPEN_FEM_3D_SUPPORT_PRESETS.zRoller },
  ],
});
/** Een camera naar `doel` vanuit richting `r` (van het doel naar de camera), op `afstand`. */
const camNaar = (doel: number[], r: number[], afstand: number, up: [number, number, number] = [0, 0, 1]): OpenFem3DCameraState => {
  const v = new THREE.Vector3(...r).normalize().multiplyScalar(afstand);
  return { position: [doel[0]! + v.x, doel[1]! + v.y, doel[2]! + v.z], target: [doel[0]!, doel[1]!, doel[2]!], up };
};
const portaalMaat = openFem3DConditionMarkerSize(scharnierTweeVelden.nodes);
/**
 * De beelden voor de schermafbeeldingen (#beeld=…): licht podium, iso, opzij
 * en van boven. Van boven in parallelle projectie met de camera boven de
 * kolomkop (in perspectief steekt de kolom anders door de camera).
 */
const SCHARNIER_BEELDEN: Record<string, {
  model: OpenFem3DModel; camera: OpenFem3DCameraState; parallel?: boolean; zicht?: Partial<OpenFem3DVisibility>;
}> = {
  "scharnier-overzicht": { model: scharnierTweeVelden, camera: { position: [14, -10.5, 8], target: [6, 0, 2], up: [0, 0, 1] } },
  // De kop van de middelste kolom: links het eind van ligger 3, rechts het begin van ligger 5.
  "scharnier-iso": { model: scharnierTweeVelden, camera: camNaar([6, 0, 4], [0.9, -1.1, 0.75], 2.4) },
  "scharnier-opzij": { model: scharnierTweeVelden, camera: camNaar([6, 0, 3.9], [0, -1, 0], 2.6) },
  "inklemming-iso": { model: scharnierTweeVelden, camera: camNaar([0, 0, -0.35 * portaalMaat], [1.1, -1.4, 0.9], 4.2 * portaalMaat) },
  "inklemming-opzij": { model: scharnierTweeVelden, camera: camNaar([0, 0, -0.35 * portaalMaat], [0, -1, 0], 4.2 * portaalMaat) },
  "inklemming-boven": { model: scharnierTweeVelden, parallel: true, camera: {
    ...camNaar([0, 0, -0.35 * portaalMaat], [0, 0, 1], 12, [0, 1, 0]), orthoHalfHeight: 1.6 * portaalMaat,
  } },
  "opleggingen-naast-elkaar": { model: opleggingenNaastElkaar, camera: camNaar([1.6, 0, 0.3], [0.9, -1.3, 0.8], 4.6) },
};

type Scharnierbol = {
  beamId: number; end: string; positie: THREE.Vector3; straal: number; kleur: number; batch: boolean;
  /** De getekende buitenstraal van de rand eromheen (uit de mesh of de instantie gelezen). */
  rand: number;
  /** Diepteverschuiving naar de camera (profielweergave) en of de dieptetoets aan staat. */
  bias: number; dieptetoets: boolean;
};
/** De scharnierbolletjes in de scène die het tekenvlak het laatst tekende, elk met zijn rand. */
function scharnierBollen(): { bollen: Scharnierbol[]; randen: number } {
  ok(renderScene, "er is getekend");
  const bollen: Scharnierbol[] = [];
  const randen: { positie: THREE.Vector3; straal: number }[] = [];
  const matrix = new THREE.Matrix4(), positie = new THREE.Vector3(), draai = new THREE.Quaternion(), schaal = new THREE.Vector3();
  const kleur = new THREE.Color();
  renderScene!.updateMatrixWorld(true);
  renderScene!.traverse((object) => {
    if (object.userData.openFem3dBeamHinge !== true || !object.visible) return;
    const rand = object.userData.openFem3dBeamHingeRim === true;
    const materiaal = (object as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const lees = (index: number | null) => {
      if (index === null) object.matrixWorld.decompose(positie, draai, schaal);
      else {
        (object as THREE.InstancedMesh).getMatrixAt(index, matrix);
        matrix.premultiply(object.matrixWorld).decompose(positie, draai, schaal);
      }
      ok(Math.abs(schaal.x - schaal.y) < 1e-12 && Math.abs(schaal.x - schaal.z) < 1e-12, "een bol, geen ellipsoïde");
      if (rand) { randen.push({ positie: positie.clone(), straal: schaal.x }); return; }
      const bias = object.userData.openFem3dHingeDepthBias;
      if (index !== null) (object as THREE.InstancedMesh).getColorAt(index, kleur);
      bollen.push({
        beamId: index === null ? object.userData.id : object.userData.instanceIds[index],
        end: index === null ? object.userData.openFem3dBeamHingeEnd : object.userData.openFem3dBeamHingeEnds[index],
        positie: positie.clone(), straal: schaal.x, kleur: index === null ? materiaal.color.getHex() : kleur.getHex(),
        batch: index !== null, rand: Number.NaN, bias: Array.isArray(bias) ? bias[index!] : bias, dieptetoets: materiaal.depthTest,
      });
    };
    if (object instanceof THREE.InstancedMesh) for (let index = 0; index < object.count; index += 1) lees(index);
    else lees(null);
  });
  for (const bol of bollen) {
    const eigen = randen.filter((rand) => rand.positie.distanceTo(bol.positie) < 1e-9);
    ok(eigen.length === 1, `${bol.beamId}${bol.end}: precies één rand om het bolletje (${eigen.length})`);
    bol.rand = eigen[0]!.straal;
  }
  return { bollen, randen: randen.length };
}
/** De straal van de getekende knoopbollen. */
function knoopbolStraal(): number {
  let straal = Number.NaN;
  renderScene?.traverse((object) => {
    if (object.userData.openFem3dNodeVisual === true && object instanceof THREE.InstancedMesh) {
      straal = (object.geometry as THREE.SphereGeometry).parameters.radius;
    }
  });
  ok(Number.isFinite(straal), "knoopbollen getekend");
  return straal;
}
const bolTekst = (bollen: Scharnierbol[]) => bollen.map((b) => `${b.beamId}${b.end}`).sort();
/** De straal van een analytische staaf in het tekenvlak (ANALYTICAL_BEAM_RADIUS_M). */
const STAAFSTRAAL = 0.035;
/**
 * Toets een scharnierbolletje tegen de knoopbol en de staaf: kleiner dan de
 * knoopbol, ook met de werkelijk getekende rand; duidelijk dikker dan de
 * staaf; met een dunne rand; en vrij van de knoopbol.
 */
function toetsMaat(bol: Scharnierbol, knoop: number, knooppunt: THREE.Vector3, maat: number) {
  const naam = `${bol.beamId}${bol.end}`;
  ok(bol.rand <= 0.85 * knoop, `${naam}: met de rand kleiner dan de knoopbol (${bol.rand.toFixed(4)} tegen ${knoop.toFixed(4)} m)`);
  ok(bol.straal >= 1.25 * STAAFSTRAAL - 1e-9, `${naam}: duidelijk dikker dan de staaf (${bol.straal.toFixed(4)} tegen ${STAAFSTRAAL} m)`);
  ok(bol.rand > bol.straal && bol.rand <= 1.15 * bol.straal, `${naam}: een dunne rand (${(bol.rand / bol.straal).toFixed(3)} × de straal)`);
  ok(knoop >= 2.2 * STAAFSTRAAL - 1e-9, `knoopbol minstens 2,2 × de staafstraal (${knoop.toFixed(4)} m)`);
  const vrij = bol.positie.distanceTo(knooppunt) - knoop - bol.rand;
  ok(vrij > 0.1 * maat, `${naam}: raakt de knoopbol niet, ook niet met de rand (${vrij.toFixed(3)} m vrij)`);
}
/**
 * De kleur van het beeld op schermpunt `p`. De laatst getekende scène wordt
 * nog eens getekend en meteen uitgelezen: zonder preserveDrawingBuffer is de
 * tekenbuffer alleen binnen dezelfde taak geldig.
 */
function beeldpunt(p: Pt): [number, number, number] {
  ok(renderRenderer && renderScene && renderCamera, "er is getekend");
  renderRenderer!.render(renderScene!, renderCamera!);
  const gl = renderRenderer!.getContext();
  const doek = renderRenderer!.domElement;
  const sx = doek.width / doek.clientWidth, sy = doek.height / doek.clientHeight;
  const px = new Uint8Array(4);
  gl.readPixels(Math.round(p.x * sx), Math.round(doek.height - p.y * sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [px[0]!, px[1]!, px[2]!];
}
/** Het lichte bolletje (wit, belicht lichtgrijs): helder en zonder kleur. */
const licht = ([r, g, b]: number[]) => Math.min(r!, g!, b!) >= 150 && Math.max(r!, g!, b!) - Math.min(r!, g!, b!) < 30;
const blauw = ([r, , b]: number[]) => b! > r! + 60;
/** De delen van een opleggingsteken van knoop `nodeId` (los getekend): geometrie, kleur, maten, wereldpositie. */
function opleggingsDelen(nodeId: number) {
  const delen: { soort: string; kleur: number; maten: Record<string, number>; positie: THREE.Vector3 }[] = [];
  renderScene!.updateMatrixWorld(true);
  renderScene!.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    if (object.userData.type !== "node" || object.userData.id !== nodeId) return;
    delen.push({
      soort: object.geometry.type, kleur: (object.material as THREE.MeshStandardMaterial).color.getHex(),
      maten: { ...(object.geometry as THREE.BoxGeometry).parameters }, positie: object.getWorldPosition(new THREE.Vector3()),
    });
  });
  return delen;
}
const ORANJE_TEKEN = 0xd97706, DONKER_TEKEN = 0x475569, GRIJZE_GROND = 0x94a3b8;

// Een klein portaal van 3 × 2,5 m: daar is de knoopbol het kleinst.
const kleinPortaal = pinOpenFem3DBeamsToColumns(parseOpenFem3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 2.5 }, { id: 3, x: 3, y: 0, z: 0 }, { id: 4, x: 3, y: 0, z: 2.5 }],
  beams: scharnierBasis.beams,
  supports: scharnierBasis.supports,
})).model;
// Profielweergave: een HEA 300-portaal op y = 3 met de scharnierende ligger
// 3 (2→4), en vóór het begin van die ligger, op y = 0, een losse HEA 300 (4).
const HEA = { profileName: "HEA 300", material: "S235" };
const voorEnAchter = pinOpenFem3DBeamsToColumns(parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 3, z: 0 }, { id: 2, x: 0, y: 3, z: 4 }, { id: 3, x: 6, y: 3, z: 0 }, { id: 4, x: 6, y: 3, z: 4 },
    { id: 5, x: -1, y: 0, z: 4 }, { id: 6, x: 2, y: 0, z: 4 },
  ],
  beams: [...scharnierBasis.beams.map((beam) => ({ ...beam, ...HEA })), { id: 4, startNodeId: 5, endNodeId: 6, ...HEA }],
  supports: scharnierBasis.supports,
})).model;
// Hetzelfde met een tweede veld (kolom 4, ligger 5): vier scharnieren, dus de
// bolletjes in een GPU-batch met de diepteverschuiving per instantie. De losse
// HEA 300 (6) staat weer vóór het begin van ligger 3.
const voorEnAchterBatch = pinOpenFem3DBeamsToColumns(parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 3, z: 0 }, { id: 2, x: 0, y: 3, z: 4 }, { id: 3, x: 6, y: 3, z: 0 }, { id: 4, x: 6, y: 3, z: 4 },
    { id: 5, x: 12, y: 3, z: 0 }, { id: 6, x: 12, y: 3, z: 4 }, { id: 7, x: -1, y: 0, z: 4 }, { id: 8, x: 2, y: 0, z: 4 },
  ],
  beams: [
    ...scharnierBasis.beams.map((beam) => ({ ...beam, ...HEA })), { id: 4, startNodeId: 5, endNodeId: 6, ...HEA },
    { id: 5, startNodeId: 4, endNodeId: 6, ...HEA }, { id: 6, startNodeId: 7, endNodeId: 8, ...HEA },
  ],
  supports: [...scharnierBasis.supports, { nodeId: 5, ...INKLEMMING }],
})).model;
// Een lange rij van 130 kolommen met scharnierende liggers ertussen: 260
// knopen, zodat het verplaatsen van een knoop de snelle weg neemt.
const langeRij = pinOpenFem3DBeamsToColumns(parseOpenFem3DModel({
  nodes: Array.from({ length: 130 }, (_, k) => [{ id: 2 * k + 1, x: 3 * k, y: 0, z: 0 }, { id: 2 * k + 2, x: 3 * k, y: 0, z: 4 }]).flat(),
  beams: [
    ...Array.from({ length: 130 }, (_, k) => ({ id: k + 1, startNodeId: 2 * k + 1, endNodeId: 2 * k + 2 })),
    ...Array.from({ length: 129 }, (_, k) => ({ id: 131 + k, startNodeId: 2 * k + 2, endNodeId: 2 * k + 4 })),
  ],
  supports: Array.from({ length: 130 }, (_, k) => ({ nodeId: 2 * k + 1, ...INKLEMMING })),
})).model;

// De bolletjes in het kleine portaal van dichtbij, en in de profielweergave
// (het begin van de achterste ligger zit achter de HEA 300 ervoor).
SCHARNIER_BEELDEN["scharnier-klein"] = { model: kleinPortaal, camera: camNaar([3, 0, 2.5], [0.9, -1.1, 0.75], 1.6) };
SCHARNIER_BEELDEN["scharnier-profiel"] = {
  model: voorEnAchter, camera: camNaar([3, 1.5, 3.6], [0.35, -1, 0.45], 9), zicht: { profiles: true },
};

// Een tekenvlak dat model en zichtbaarheid in zijn eigen toestand houdt: een
// wijziging gaat als nieuwe props naar hetzelfde tekenvlak, zoals in de app,
// en neemt dus de snelle wegen (staven of profielen aan/uit, knoop verplaatsen).
let zetWisselModel: (model: OpenFem3DModel) => void = () => {};
let zetWisselZicht: (zicht: OpenFem3DVisibility) => void = () => {};
function Wisselvlak({ begin, zicht, camera: cam }: { begin: OpenFem3DModel; zicht: OpenFem3DVisibility; camera: OpenFem3DCameraState }) {
  const [model, setModel] = useState(begin);
  const [visibility, setVisibility] = useState(zicht);
  const [cameraVerzoek] = useState({ state: cam, token: 1 });
  zetWisselModel = (next) => flushSync(() => setModel(next));
  zetWisselZicht = (next) => flushSync(() => setVisibility(next));
  return <div className="open-fem3d-stage" style={{ width: BREED, height: HOOG, flex: "none" }}>
    <ThreeFrameCanvas
      model={model} onChange={() => {}} tool="select" selection={null} onSelect={() => {}} onToolChange={() => {}}
      fitToken={0} visibility={visibility} utilizations={GEEN_BENUTTINGEN} cameraRequest={cameraVerzoek} result={null}
    />
  </div>;
}

async function scharnierProeven() {
  const vooraan = camNaar([3, 0, 2.5], [0, -1, 0], 12);
  await test("scharnier: een klein licht bolletje met een donkere rand op de ligger, net vóór elke kolomknoop", async () => {
    await toon(scharnierPortaal, { ...snel }, { camera: vooraan });
    gelijk(diag().openFem3dBeamHinges, "2", "diagnose: twee scharnieren");
    const { bollen, randen } = scharnierBollen();
    gelijk(bolTekst(bollen), ["3end", "3start"], "aan beide einden van ligger 3, niet op de kolommen");
    gelijk(randen, 2, "elk bolletje met een rand");
    const knoop = knoopbolStraal();
    const maat = openFem3DConditionMarkerSize(scharnierPortaal.nodes);
    for (const bol of bollen) {
      const eind = new THREE.Vector3(bol.end === "start" ? 0 : 6, 0, 4);
      const afstand = bol.positie.distanceTo(eind);
      ok(Math.abs(bol.positie.y) < 1e-9 && Math.abs(bol.positie.z - 4) < 1e-9, `${bol.end}: op de staafas (${bol.positie.toArray()})`);
      ok(bol.end === "start" ? bol.positie.x > 0 : bol.positie.x < 6, `${bol.end}: op de ligger, aan de kant van de staaf`);
      toetsMaat(bol, knoop, eind, maat);
      ok(afstand < maat, `${bol.end}: net vóór de knoop (${afstand.toFixed(3)} m, maat ${maat.toFixed(3)} m)`);
      gelijk([bol.kleur, bol.batch, bol.dieptetoets, bol.bias], [0xffffff, false, true, 0], `${bol.end}: wit, los getekend, in de diepte`);
    }
    // Te zien: licht in het midden van het bolletje, vlak naast de rand de blauwe staaf.
    const begin = bollen.find((bol) => bol.end === "start")!;
    const cam = camera();
    const opBol = beeldpunt(scherm(cam, begin.positie));
    const opStaaf = beeldpunt(scherm(cam, begin.positie.clone().add(new THREE.Vector3(begin.rand + 0.03, 0, 0))));
    ok(licht(opBol) && blauw(opStaaf), `het bolletje is te zien (${opBol}), naast de rand de staaf (${opStaaf})`);
    // Een klik op het bolletje kiest de ligger en kleurt het bolletje mee.
    klik(scherm(cam, begin.positie));
    gelijk(selectie, { type: "beam", id: 3 }, "klik op het bolletje");
    await wacht();
    gelijk(scharnierBollen().bollen.map((bol) => bol.kleur), [SELECTIEKLEUR, SELECTIEKLEUR], "beide bolletjes in de selectiekleur");
    await geenSelectie();
    gelijk(scharnierBollen().bollen.map((bol) => bol.kleur), [0xffffff, 0xffffff], "na deselecteren weer wit");
  });

  await test("scharnier: ook in een klein portaal (3 × 2,5 m) een kleine bol vóór de grote, met de rand kleiner dan de knoopbol", async () => {
    await toon(kleinPortaal, { ...snel }, { camera: camNaar([1.5, 0, 2.2], [0, -1, 0], 5) });
    const { bollen } = scharnierBollen();
    gelijk(bolTekst(bollen), ["3end", "3start"], "twee bolletjes");
    const knoop = knoopbolStraal();
    gelijk(knoop.toFixed(4), (2.2 * STAAFSTRAAL).toFixed(4), "de knoopbol op zijn ondergrens");
    const maat = openFem3DConditionMarkerSize(kleinPortaal.nodes);
    for (const bol of bollen) toetsMaat(bol, knoop, new THREE.Vector3(bol.end === "start" ? 0 : 3, 0, 2.5), maat);
    // Op het scherm: het bolletje (met rand) is kleiner dan de knoopbol en breder dan de staaf.
    const cam = camera();
    const straalPx = (p: THREE.Vector3, r: number) => scherm(cam, p.clone().add(new THREE.Vector3(0, 0, r))).y - scherm(cam, p).y;
    const bol = bollen[0]!;
    const [d, k, s] = [-straalPx(bol.positie, bol.rand), -straalPx(new THREE.Vector3(0, 0, 2.5), knoop), -straalPx(bol.positie, STAAFSTRAAL)];
    ok(d < 0.9 * k && d > 1.3 * s, `op het scherm: bolletje ${(2 * d).toFixed(1)} px, knoopbol ${(2 * k).toFixed(1)} px, staaf ${(2 * s).toFixed(1)} px`);
  });

  await test("scharnier: zonder scharnier geen bolletjes; met de staven uit ook niet", async () => {
    await toon(scharnierVrij, { ...snel }, { camera: vooraan });
    gelijk([diag().openFem3dBeamHinges, scharnierBollen().bollen.length, scharnierBollen().randen], ["0", 0, 0], "momentvast portaal");
    await toon(scharnierPortaal, { ...snel, beams: false }, { camera: vooraan });
    gelijk([diag().openFem3dBeamHinges, scharnierBollen().bollen.length, scharnierBollen().randen], ["0", 0, 0], "staven uit");
  });

  await test("scharnier: langs de snelle wegen (zonder opnieuw te mounten): staven uit en aan, profielen aan en uit", async () => {
    mount(<Wisselvlak begin={scharnierPortaal} zicht={{ ...snel }} camera={vooraan} />);
    await wacht(200);
    gelijk([diag().openFem3dBeamHinges, scharnierBollen().bollen.length], ["2", 2], "begin: twee bolletjes");
    zetWisselZicht({ ...snel, beams: false });
    await wacht();
    gelijk([diag().openFem3dBuildMode, diag().openFem3dBeamHinges, scharnierBollen().bollen.length, scharnierBollen().randen],
      ["beam-visibility", "0", 0, 0], "staven uit: de snelle weg, geen bolletjes en geen randen");
    zetWisselZicht({ ...snel });
    await wacht();
    gelijk([diag().openFem3dBuildMode, diag().openFem3dBeamHinges, bolTekst(scharnierBollen().bollen)],
      ["beam-visibility", "2", ["3end", "3start"]], "staven weer aan: de bolletjes terug");
    zetWisselZicht({ ...snel, profiles: true });
    await wacht();
    const profiel = scharnierBollen().bollen;
    gelijk([diag().openFem3dBuildMode, profiel.length], ["beam-profiles", 2], "profielen aan: de snelle weg");
    ok(profiel.every((bol) => bol.dieptetoets && bol.bias > 0), `profielen aan: met dieptetoets en diepteverschuiving (${profiel.map((bol) => bol.bias)})`);
    zetWisselZicht({ ...snel });
    await wacht();
    ok(scharnierBollen().bollen.every((bol) => bol.bias === 0), "profielen uit: geen diepteverschuiving meer");
    // Een knoop verplaatsen in een groot model (vanaf 250 knopen de snelle weg): de bolletjes gaan mee.
    mount(<Wisselvlak begin={langeRij} zicht={{ ...snel }} camera={camNaar([3, 0, 3.5], [0, -1, 0], 7)} />);
    await wacht(250);
    gelijk(diag().openFem3dBeamHinges, String(2 * 129), "lange rij: twee bolletjes per ligger");
    const verplaatst = { ...langeRij, nodes: langeRij.nodes.map((node) => node.id === 4 ? { ...node, z: 3.5 } : node) };
    zetWisselModel(verplaatst);
    await wacht();
    gelijk(diag().openFem3dBuildMode, "move-nodes", "knoop 4 omlaag: de snelle weg");
    const knoop4 = new THREE.Vector3(3, 0, 3.5);
    const bijKnoop4 = scharnierBollen().bollen.filter((bol) => (bol.beamId === 131 && bol.end === "end") || (bol.beamId === 132 && bol.end === "start"));
    gelijk(bijKnoop4.length, 2, "de twee bolletjes bij knoop 4");
    for (const bol of bijKnoop4) {
      const ander = new THREE.Vector3(bol.beamId === 131 ? 0 : 6, 0, 4);
      const as = ander.clone().sub(knoop4).normalize();
      const naarBol = bol.positie.clone().sub(knoop4);
      // De GPU-batch bewaart zijn matrices in 32 bits: op een honderdste millimeter.
      ok(naarBol.clone().cross(as).length() < 1e-5 && naarBol.dot(as) > 0,
        `${bol.beamId}${bol.end}: op de nieuwe staafas, aan de kant van de staaf (${bol.positie.toArray().map((v) => v.toFixed(3))})`);
    }
  });

  await test("scharnier: vier scharnieren in één GPU-batch; een klik op een bolletje kiest die staaf en kleurt alleen zijn bolletjes", async () => {
    await toon(scharnierTweeVelden, { ...snel }, { camera: camNaar([6, 0, 3], [0, -1, 0], 7) });
    gelijk(diag().openFem3dBeamHinges, "4", "diagnose");
    const { bollen, randen } = scharnierBollen();
    gelijk(bolTekst(bollen), ["3end", "3start", "5end", "5start"], "ligger 3 en ligger 5, beide einden");
    ok(bollen.every((bol) => bol.batch) && randen === 4, "bolletjes en randen elk in een GPU-batch");
    let batches = 0;
    renderScene!.traverse((object) => { if (object instanceof THREE.InstancedMesh && object.userData.openFem3dBeamHinge === true) batches += 1; });
    gelijk(batches, 2, "één batch voor de bolletjes, één voor de randen");
    const knoop = knoopbolStraal();
    const maat = openFem3DConditionMarkerSize(scharnierTweeVelden.nodes);
    for (const bol of bollen) {
      const x = ({ "3start": 0, "3end": 6, "5start": 6, "5end": 12 } as Record<string, number>)[`${bol.beamId}${bol.end}`]!;
      toetsMaat(bol, knoop, new THREE.Vector3(x, 0, 4), maat);
    }
    // Aan de kop van kolom 2 zitten twee bolletjes: links ligger 3, rechts ligger 5.
    const rechts = bollen.find((bol) => bol.beamId === 5 && bol.end === "start")!;
    ok(rechts.positie.x > 6 && Math.abs(rechts.positie.z - 4) < 1e-9, "begin van ligger 5 rechts van de kolomkop");
    klik(scherm(camera(), rechts.positie));
    gelijk(selectie, { type: "beam", id: 5 }, "klik op het rechter bolletje");
    await wacht();
    const kleuren = Object.fromEntries(scharnierBollen().bollen.map((bol) => [`${bol.beamId}${bol.end}`, bol.kleur]));
    gelijk(kleuren, { "3start": 0xffffff, "3end": 0xffffff, "5start": SELECTIEKLEUR, "5end": SELECTIEKLEUR }, "alleen de bolletjes van ligger 5");
    await geenSelectie();
    ok(scharnierBollen().bollen.every((bol) => bol.kleur === 0xffffff), "na deselecteren weer wit");
  });

  await test("scharnier: in de profielweergave door het eigen profiel heen te zien, achter een profiel ervoor niet", async () => {
    // Recht van voren: de losse HEA 300 op y = 0 staat precies vóór het begin
    // van de scharnierende ligger op y = 3; het eind van die ligger is vrij.
    await toon(voorEnAchter, { ...snel, profiles: true, supports: false }, { camera: camNaar([3, 3, 4], [0, -1, 0], 12) });
    const { bollen } = scharnierBollen();
    gelijk(bolTekst(bollen), ["3end", "3start"], "twee bolletjes");
    for (const bol of bollen) {
      // HEA 300: de verste hoek ligt √(0,15² + 0,145²) ≈ 0,21 m van de as.
      ok(bol.dieptetoets && bol.bias > 0.2 && bol.bias < 0.3 + bol.rand,
        `${bol.end}: met dieptetoets, naar voren zo ver als het profiel uitsteekt (${bol.bias.toFixed(3)} m)`);
    }
    const cam = camera();
    const begin = bollen.find((bol) => bol.end === "start")!, eind = bollen.find((bol) => bol.end === "end")!;
    const naastEind = eind.positie.clone().add(new THREE.Vector3(0, 0, eind.rand + 0.04));
    const [opEind, naast] = [beeldpunt(scherm(cam, eind.positie)), beeldpunt(scherm(cam, naastEind))];
    ok(licht(opEind) && blauw(naast), `het eind: het lichte bolletje vóór het eigen profiel (${opEind}), ernaast het profiel (${naast})`);
    const voor = beeldpunt(scherm(cam, begin.positie));
    ok(!licht(voor) && blauw(voor), `het begin: achter de HEA 300 ervoor verborgen (${voor})`);
  });

  await test("scharnier: ook in een GPU-batch (vier bolletjes) in de profielweergave door het eigen profiel heen te zien, achter een profiel ervoor niet", async () => {
    // De diepteverschuiving loopt hier via een attribuut per instantie, niet
    // via een uniform zoals bij losse bolletjes.
    await toon(voorEnAchterBatch, { ...snel, profiles: true, supports: false }, { camera: camNaar([6, 3, 4], [0, -1, 0], 16) });
    const { bollen } = scharnierBollen();
    gelijk(bolTekst(bollen), ["3end", "3start", "5end", "5start"], "vier bolletjes");
    ok(bollen.every((bol) => bol.batch && bol.dieptetoets && bol.bias > 0.2 && bol.bias < 0.3 + bol.rand),
      `in een GPU-batch, met dieptetoets en diepteverschuiving (${bollen.map((bol) => bol.bias.toFixed(3))})`);
    const cam = camera();
    for (const bol of bollen.filter((item) => !(item.beamId === 3 && item.end === "start"))) {
      const kleur = beeldpunt(scherm(cam, bol.positie));
      ok(licht(kleur), `${bol.beamId}${bol.end}: het lichte bolletje vóór het eigen profiel (${kleur})`);
    }
    const verborgen = bollen.find((bol) => bol.beamId === 3 && bol.end === "start")!;
    const voor = beeldpunt(scherm(cam, verborgen.positie));
    ok(!licht(voor) && blauw(voor), `3start: achter de HEA 300 ervoor verborgen (${voor})`);
  });

  await test("gereedschap Scharnier aan staafeind: een klik bij een eind zet My en Mz los, nog een klik weer vast; elke klik één stap", async () => {
    let historie = { model: scharnierVrij, past: [] as OpenFem3DModel[], future: [] as OpenFem3DModel[] };
    let doe: (action: Parameters<typeof openFem3dHistoryReducer>[1]) => void = () => {};
    let zetTool: (tool: OpenFem3DTool) => void = () => {};
    let editorTool: OpenFem3DTool = "select";
    function Editor() {
      const [state, dispatch] = useReducer(openFem3dHistoryReducer, historie);
      const [sel, setSel] = useState<OpenFem3DSelection>(null);
      const [tool, setTool] = useState<OpenFem3DTool>("select");
      historie = state;
      doe = dispatch;
      zetTool = setTool;
      editorTool = tool;
      return <div style={{ width: BREED, height: HOOG, display: "flex" }}>
        <OpenFem3DEditor model={state.model} onChange={(model, meta) => dispatch({ type: "edit", model, ...meta })}
          tool={tool} onToolChange={setTool} selection={sel} onSelectionChange={setSel}
          visibility={editorZicht} initialCamera={vooraan} />
      </div>;
    }
    mount(<Editor />);
    await wacht(200);
    flushSync(() => zetTool("beamEndHinge"));
    await wacht();
    const kop = container.querySelector(".open-fem3d-stage-header > span")?.textContent ?? "";
    gelijk(kop, i18next.t("ribbon:openFem3d.beamEndHingeHelp"), "de uitleg van het gereedschap in de kop");
    ok(kop.includes("My") && kop.includes("Mz"), "de uitleg noemt My en Mz");
    ok(tekenvlakEl().className.includes("open-fem3d-tool-support"), "kruisdraadcursor");
    const releases = (id: number) => historie.model.beams.find((beam) => beam.id === id)!.releases;
    const los = (id: number) => Object.entries(releases(id) ?? {}).filter(([, v]) => v).map(([k]) => k).sort().join(",") || "vast";
    const cam = camera();
    // Op 20 % van ligger 3: het begin (bij knoop 2).
    klik(scherm(cam, { x: 1.2, y: 0, z: 4 }));
    await wacht();
    gelijk([los(3), historie.past.length, diag().openFem3dBeamHinges], ["myStart,mzStart", 1, "1"], "klik bij het begin: My en Mz los, één stap, één bolletje");
    gelijk(bolTekst(scharnierBollen().bollen), ["3start"], "het bolletje bij het begin");
    gelijk(diag().openFem3dBeamEndHinge, "3:start:los", "diagnose");
    // Dezelfde plek (nu vlak naast het bolletje): weer vast.
    klik(scherm(cam, { x: 1.2, y: 0, z: 4 }));
    await wacht();
    gelijk([los(3), releases(3), historie.past.length, diag().openFem3dBeamHinges], ["vast", undefined, 2, "0"],
      "tweede klik: weer vast (zonder scharnierveld), één stap, geen bolletje");
    // Op 85 %: het eind (bij knoop 4).
    klik(scherm(cam, { x: 5.1, y: 0, z: 4 }));
    await wacht();
    gelijk([los(3), historie.past.length], ["myEnd,mzEnd", 3], "klik bij het eind");
    gelijk(bolTekst(scharnierBollen().bollen), ["3end"], "het bolletje bij het eind");
    // Een klik op het bolletje zelf zet het eind weer vast.
    klik(scherm(cam, scharnierBollen().bollen[0]!.positie));
    await wacht();
    gelijk([los(3), historie.past.length, diag().openFem3dBeamHinges], ["vast", 4, "0"], "klik op het bolletje: weer vast");
    // Kolom 1, 0,6 m onder de kop: het eind van de kolom.
    klik(scherm(cam, { x: 0, y: 0, z: 3.4 }));
    await wacht();
    gelijk([los(1), los(3), historie.past.length], ["myEnd,mzEnd", "vast", 5], "kolomkop scharnierend, de ligger niet");
    gelijk(bolTekst(scharnierBollen().bollen), ["1end"], "het bolletje onder de kolomkop");
    // Een klik in het niets verandert niets.
    klik({ x: 40, y: HOOG - 40 });
    await wacht();
    gelijk(historie.past.length, 5, "klik in het niets: geen stap");
    flushSync(() => doe({ type: "undo" }));
    await wacht();
    gelijk([los(1), historie.past.length, diag().openFem3dBeamHinges], ["vast", 4, "0"], "ongedaan maken: één klik terug");
    toets("Escape");
    await wacht();
    gelijk(editorTool, "select", "Escape: terug naar Selecteren");
  });

  await test("inklemming: een oranje blok onder de knoop, een donkere kraag om de knoop, de grijze ondergrond met arcering; een klik erop kiest de knoop", async () => {
    const maat = openFem3DConditionMarkerSize(scharnierPortaal.nodes);
    await toon(scharnierPortaal, { ...snel }, { camera: camNaar([0, 0, -0.4 * maat], [1.1, -1.4, 0.9], 5 * maat) });
    const delen = opleggingsDelen(1);
    const blokken = delen.filter((deel) => deel.soort === "BoxGeometry" && deel.kleur === ORANJE_TEKEN);
    gelijk(blokken.length, 1, "één oranje blok");
    const blok = blokken[0]!;
    ok(Math.abs(blok.positie.z + blok.maten.height / 2) < 1e-9 && Math.hypot(blok.positie.x, blok.positie.y) < 1e-9,
      `bovenkant van het blok op de knoop (${(blok.positie.z + blok.maten.height / 2).toFixed(4)})`);
    ok(delen.some((deel) => deel.soort === "BoxGeometry" && deel.kleur === DONKER_TEKEN && deel.positie.length() < 1e-9
      && deel.maten.width > 0.2 * maat), "de donkere kraag om de knoop");
    gelijk(delen.filter((deel) => deel.kleur === GRIJZE_GROND).length, 1, "de grijze ondergrond");
    gelijk(delen.filter((deel) => deel.kleur === DONKER_TEKEN && deel.maten.width < 0.1 * maat).length, 4, "vier arceringsstreepjes");
    ok(!delen.some((deel) => deel.soort === "ConeGeometry" || deel.soort === "CylinderGeometry" || deel.soort === "TorusGeometry"),
      `geen kegel, schijf of ring (${[...new Set(delen.map((deel) => deel.soort))].join(", ")})`);
    // Een klik op de voorkant van het blok, onder de knoop.
    klik(scherm(camera(), { x: 0, y: -0.5 * blok.maten.depth, z: blok.positie.z }));
    gelijk(selectie, { type: "node", id: 1 }, "klik op het blok");
  });

  await test("inklemming in GPU-batches (vier tekens): blok, kraag, ondergrond en arcering; een klik op een blok kiest zijn knoop", async () => {
    const maat = openFem3DConditionMarkerSize(vierInklemmingen.nodes);
    await toon(vierInklemmingen, { ...snel }, { camera: camNaar([4.5, 0, 0.6], [0.5, -1.4, 0.7], 11) });
    const vormen: string[] = [];
    renderScene!.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh) || object.userData.type !== "node" || object.userData.openFem3dNodeVisual
        || object.userData.openFem3dNodeHit) return;
      const p = (object.geometry as THREE.BoxGeometry).parameters;
      vormen.push(`${object.geometry.type} ${(p.width / maat).toFixed(2)}×${(p.height / maat).toFixed(2)} ×${object.count}`);
    });
    gelijk(vormen.sort(), ["BoxGeometry 0.06×0.34 ×16", "BoxGeometry 0.46×0.18 ×4", "BoxGeometry 1.10×0.75 ×4", "BoxGeometry 1.80×0.06 ×4"],
      "vier batches: arcering, kraag, blok en ondergrond");
    klik(scherm(camera(), { x: 6, y: -0.55 * maat, z: -0.375 * maat }));
    gelijk(selectie, { type: "node", id: 5 }, "klik op het derde blok");
  });
}

// ── React StrictMode (ontwikkelbundel): eigen groep, eigen bundel en browserproces ──
async function strikteProeven() {
  await test("StrictMode: een lintaanzicht bij het mounten blijft staan, ook al bouwt React de scène tweemaal op (perspectief en parallel)", async () => {
    ok(process.env.NODE_ENV === "development", "opzet: de ontwikkelbundel (alleen daar voert StrictMode effecten tweemaal uit)");
    for (const [stand, zicht] of [["perspectief", { ...snel }], ["parallel", parallelZicht({ ...snel })]] as const) {
      const voor = rendererTeller;
      mount(<React.StrictMode><Tekenvlak model={portaal} visibility={zicht} viewRequest={{ kind: "top", token: 3 }} /></React.StrictMode>);
      await wacht(250);
      gelijk(rendererTeller - voor, 2, `${stand}, opzet: de scène is tweemaal opgebouwd`);
      gelijk(diag().openFem3dProjection, stand === "parallel" ? "orthographic" : "perspective", `${stand}: projectie`);
      richtingIs([0, 0, 1], `${stand}: bovenaanzicht`);
      gelijk(diag().openFem3dCameraUp, "0.000000,1.000000,0.000000", `${stand}: Y omhoog`);
    }
  });
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });
