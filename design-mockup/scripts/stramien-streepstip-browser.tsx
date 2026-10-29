/**
 * Browserkant van test-stramien-streepstip-ui.mjs (issue #103): het echte
 * 3D-tekenvlak (ThreeFrameCanvas, WebGL) en het echte 2D-tekenvlak
 * (FemCanvas) met een stramien, in een lokale headless browser.
 *
 * 3D, een vak van 4 × 2 m met stramienassen x = 0 en 6 m, y = 0 en 4 m en
 * levels 0 en 3 m:
 *  - bovenaanzicht, parallel: langs stramienas x = 0 wordt het beeld zelf
 *    gelezen. De stukken getekend/niet zijn streep-stip 16-4-2-4 px (±1,5 px),
 *    en elke pixelrij klopt met de regel vanaf het begin van de lijn (de lijn
 *    begint met een streep);
 *  - tweemaal in- en tweemaal uitgezoomd: hetzelfde patroon in px
 *    (schermvast), terwijl de lijn op het scherm twee keer zo lang of kort is;
 *  - perspectief, iso: de schaal van beide stramienmaterialen is de
 *    pixels-per-meter bij het draaipunt van de camera;
 *  - section box om het midden van het model: de staaf buiten de doos is weg,
 *    het patroon op as x = 0 (buiten de doos) staat er nog, de
 *    stramienmaterialen hebben geen clipping planes;
 *  - peilmaten: één per level, ook met het streep-stip;
 *  - precies twee streep-stiplijnen (assen en levels) in de scène.
 * 2D: de berekende stijl van elke `.fem-stramien-line` (verticale assen en
 * niveaulijnen) is streep-stip, met de kleur en dekking van voorheen.
 *
 * Met `#beeld=3d-boven|3d-iso|3d-doos|2d` wordt alleen het beeld opgebouwd —
 * daarvan maakt de test op verzoek een schermafbeelding.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as THREE from "three";
import common from "../src/i18n/locales/nl/common.json";
import check from "../src/i18n/locales/nl/check.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import FemCanvas from "../src/components/fem/FemCanvas";
import { parseOpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DView } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_GRID, type Selection, type StructuralGrid } from "../src/components/fem/femTypes";
import { makeInitialSnapshot } from "../src/hooks/useFemStore";
import { STRAMIEN_STREEPSTIP_PX, stramienStreepStipGetekend } from "../src/lib/stramienStreepStip";

// De WebGL-buffer bewaren, zodat de test de pixels van het 3D-beeld kan lezen.
const eigenGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, soort: string, opties?: Record<string, unknown>) {
  if (soort === "webgl" || soort === "webgl2") opties = { ...(opties ?? {}), preserveDrawingBuffer: true };
  return (eigenGetContext as (s: string, o?: unknown) => RenderingContext | null).call(this, soort, opties);
} as typeof HTMLCanvasElement.prototype.getContext;

// De camera en scène waarmee het tekenvlak echt tekent.
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

const BREED = 1000, HOOG = 650;
const tests: { name: string; error?: string }[] = [];
const info: string[] = [];
const container = document.getElementById("root")!;
let root = createRoot(container);
function mount(element: React.ReactNode) {
  flushSync(() => root.unmount());
  root = createRoot(container);
  flushSync(() => root.render(element));
}
const wacht = (ms = 60) => new Promise((r) => setTimeout(r, ms));
function ok(v: unknown, m: string) { if (!v) throw Error(m); }
function gelijk(a: unknown, b: unknown, m: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
function bijna(a: number, b: number, tol: number, m: string) {
  if (!(Math.abs(a - b) <= tol)) throw Error(`${m}: ${a} ≠ ${b} (±${tol})`);
}
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}

/* ── 3D: model en stramien ────────────────────────────────────────────── */

/** Een vak van 4 × 2 m (x 1…5, y 1…3), kolommen van 3 m, randliggers op 3 m; geen staaf op een stramienas. */
const vak = (() => {
  const hoeken: [number, number][] = [[1, 1], [5, 1], [5, 3], [1, 3]];
  const nodes = [
    ...hoeken.map(([x, y], i) => ({ id: i + 1, x, y, z: 0 })),
    ...hoeken.map(([x, y], i) => ({ id: i + 5, x, y, z: 3 })),
  ];
  const beams = [
    ...hoeken.map((_, i) => ({ id: i + 1, startNodeId: i + 1, endNodeId: i + 5, profileName: "HEA 200", material: "S235" })),
    ...hoeken.map((_, i) => ({ id: i + 5, startNodeId: i + 5, endNodeId: ((i + 1) % 4) + 5, profileName: "IPE 200", material: "S235" })),
  ];
  return parseOpenFem3DModel({ nodes, beams, supports: [], loads: [] });
})();
const STRAMIEN: StructuralGrid = {
  enabled: true,
  xAxes: [{ id: "A", label: "A", position: 0 }, { id: "B", label: "B", position: 6000 }],
  yAxes: [{ id: "1", label: "1", position: 0 }, { id: "2", label: "2", position: 4000 }],
  zAxes: [{ id: "p0", label: "", position: 0 }, { id: "p3", label: "", position: 3000 }],
};
/** Het stramienkader: x −1…7, y −1…5 (marge 1 m); as x = 0 loopt van y = −1 tot 5. */
const AS_BEGIN: [number, number, number] = [0, -1, 0];

const GEEN_BENUTTINGEN: never[] = [];
const ZICHT: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, grid: false, axes: false, viewCube: false, nodeNumbers: false, perspective: false,
};
const boven = (halveHoogte: number): OpenFem3DCameraState => ({
  position: [3, 2, 40], target: [3, 2, 0], up: [0, 1, 0], orthoHalfHeight: halveHoogte,
});

let zetZicht: (zicht: OpenFem3DVisibility) => void = () => {};
let zetCamera: (camera: OpenFem3DCameraState) => void = () => {};
function Tekenvlak3D({ zicht: beginZicht, view, camera }: { zicht: OpenFem3DVisibility; view: OpenFem3DView; camera?: OpenFem3DCameraState }) {
  const [zicht, setZicht] = useState(beginZicht);
  const [cameraVerzoek, setCameraVerzoek] = useState(camera ? { state: camera, token: 1 } : undefined);
  zetZicht = (next) => flushSync(() => setZicht(next));
  zetCamera = (state) => flushSync(() => setCameraVerzoek((vorig) => ({ state, token: (vorig?.token ?? 0) + 1 })));
  return <div className="open-fem3d-stage" style={{ width: BREED, height: HOOG, flex: "none" }}>
    <ThreeFrameCanvas model={vak} onChange={() => {}} tool="select" selection={null} onSelect={() => {}}
      fitToken={0} visibility={zicht} structuralGrid={STRAMIEN} viewRequest={{ kind: view, token: 1 }}
      utilizations={GEEN_BENUTTINGEN} cameraRequest={cameraVerzoek} />
  </div>;
}
async function toon3D(zicht: OpenFem3DVisibility, view: OpenFem3DView, camera?: OpenFem3DCameraState) {
  mount(<Tekenvlak3D zicht={zicht} view={view} camera={camera} />);
  await wacht(300);
}
const tekenvlak = () => container.querySelector<HTMLElement>(".open-fem3d-canvas")!;
const canvas3d = () => tekenvlak().querySelector("canvas")!;

/** De streep-stiplijnen in de scène waarmee net getekend is. */
function streepStipLijnen(): THREE.LineSegments[] {
  const uit: THREE.LineSegments[] = [];
  renderScene?.traverse((o) => { if (o.userData.openFem3dStreepStip) uit.push(o as THREE.LineSegments); });
  return uit;
}

/** Schermpunt (CSS-px binnen het canvas) van een wereldpunt, met de camera waarmee getekend is. */
function scherm(p: readonly [number, number, number]) {
  ok(renderCamera, "nog niet getekend");
  const rect = canvas3d().getBoundingClientRect();
  const n = new THREE.Vector3(...p).project(renderCamera!);
  return { x: (n.x + 1) * rect.width / 2, y: (1 - n.y) * rect.height / 2 };
}

/** De pixels van het 3D-beeld (framebufferpixels) en hun schaal t.o.v. CSS-px. */
function beeld() {
  const bron = canvas3d();
  const doek = document.createElement("canvas");
  doek.width = bron.width; doek.height = bron.height;
  const ctx = doek.getContext("2d")!;
  ctx.drawImage(bron, 0, 0);
  const data = ctx.getImageData(0, 0, doek.width, doek.height).data;
  const schaal = bron.width / bron.getBoundingClientRect().width;
  const helderheid = (x: number, y: number) => {
    const i = (Math.round(y) * doek.width + Math.round(x)) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  return { schaal, helderheid };
}

/**
 * Langs de verticale stramienas door wereldpunt (x, ·, z) van y = `yVan` tot
 * `yTot`: per pixelrij getekend of niet (het donkerste van vijf kolommen rond
 * de as, tegen het wit van de achtergrond), plus de afstand van die rij tot
 * het begin van de lijn in CSS-px.
 */
function leesAs(x: number, z: number, yVan: number, yTot: number) {
  const { schaal, helderheid } = beeld();
  const a = scherm([x, yVan, z]), b = scherm([x, yTot, z]), begin = scherm(AS_BEGIN);
  ok(Math.abs(a.x - b.x) < 0.5, `de as staat niet verticaal op het scherm (${a.x} / ${b.x})`);
  const kolom = a.x * schaal;
  const rijen: { aan: boolean; afstandPx: number }[] = [];
  const [r0, r1] = [Math.ceil(Math.min(a.y, b.y) * schaal), Math.floor(Math.max(a.y, b.y) * schaal)];
  for (let r = r0; r <= r1; r++) {
    let donker = 0;
    for (let dx = -2; dx <= 2; dx++) donker = Math.max(donker, 255 - helderheid(kolom + dx, r));
    rijen.push({ aan: donker > 40, afstandPx: Math.abs((r + 0.5) / schaal - begin.y) });
  }
  return { rijen, schaal };
}

/** Stukken getekend/niet als [aan, lengte in CSS-px]; het eerste en laatste (afgekapte) stuk vallen weg. */
function stukken(rijen: { aan: boolean }[], schaal: number): [boolean, number][] {
  const uit: [boolean, number][] = [];
  for (const rij of rijen) {
    const laatste = uit[uit.length - 1];
    if (laatste && laatste[0] === rij.aan) laatste[1] += 1 / schaal;
    else uit.push([rij.aan, 1 / schaal]);
  }
  return uit.slice(1, -1);
}

/** Het patroon langs de as: streep-stip 16-4-2-4 (±1,5 px) en rij voor rij gelijk aan de regel. */
function controleerStreepStip(x: number, z: number, yVan: number, yTot: number, wat: string) {
  const { rijen, schaal } = leesAs(x, z, yVan, yTot);
  const reeks = stukken(rijen, schaal);
  const tekst = reeks.map(([aan, l]) => `${aan ? "+" : "-"}${l.toFixed(1)}`).join(" ");
  info.push(`${wat}: ${tekst.slice(0, 160)}`);
  const [streep, tussen, stip] = STRAMIEN_STREEPSTIP_PX;
  ok(reeks.length >= 8, `${wat}: te weinig stukken (${tekst})`);
  const getekend = reeks.filter(([aan]) => aan).map(([, l]) => l);
  const gaten = reeks.filter(([aan]) => !aan).map(([, l]) => l);
  for (const l of gaten) bijna(l, tussen, 1.5, `${wat}: tussenruimte (${tekst})`);
  for (const l of getekend) ok(Math.abs(l - streep) <= 1.5 || Math.abs(l - stip) <= 1.5, `${wat}: ${l.toFixed(1)} px is geen streep en geen stip (${tekst})`);
  for (let i = 1; i < getekend.length; i++) {
    ok((getekend[i] > 8) !== (getekend[i - 1] > 8), `${wat}: streep en stip wisselen niet af (${tekst})`);
  }
  // Rij voor rij tegen de regel vanaf het begin van de lijn, behalve vlak bij een overgang.
  const grens = (d: number) => [0, streep, streep + tussen, streep + tussen + stip].some((g) => {
    const t = d - 26 * Math.floor(d / 26);
    return Math.abs(t - g) <= 1.5 || Math.abs(t - g - 26) <= 1.5 || Math.abs(t - g + 26) <= 1.5;
  });
  const fout = rijen.filter((r) => !grens(r.afstandPx) && r.aan !== stramienStreepStipGetekend(r.afstandPx));
  ok(fout.length === 0, `${wat}: ${fout.length} rijen wijken af van de regel, bv. ${JSON.stringify(fout.slice(0, 3))}`);
  return reeks;
}

/* ── 2D ───────────────────────────────────────────────────────────────── */

const model2d = makeInitialSnapshot();
const STRAMIEN_2D: StructuralGrid = {
  enabled: true,
  xAxes: [{ id: "A", label: "A", position: 0 }, { id: "B", label: "B", position: 12000 }],
  zAxes: [{ id: "p0", label: "", position: 0 }, { id: "p5", label: "", position: 5000 }],
};
const noop = () => {};
function Tekenvlak2D() {
  return (
    <div className="fem-canvas-wrap" style={{ width: BREED, height: HOOG, position: "relative" }}>
      <FemCanvas
        tool="select" nodes={model2d.nodes} beams={model2d.beams} supports={model2d.supports} plates={[]} loads={model2d.loads}
        selection={null as unknown as Selection} activeLoadCaseId={1} grid={{ ...DEFAULT_GRID, visible: false }}
        structuralGrid={STRAMIEN_2D}
        setSelection={noop} addNode={() => 0} updateNode={noop} addBeam={() => null}
        addPlate={() => 0} addSupport={noop} addLoad={noop} deleteSelected={noop} splitBeamAt={noop}
        translateSelection={() => false} copySelection={() => false}
        rotateSelection={() => false} mirrorSelection={() => false}
        displayFlags={DEFAULT_DISPLAY_FLAGS} showLoads={false} resultsMode={false}
      />
    </div>
  );
}

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function toonBeeld(naam: string) {
  document.getElementById("uitslag")!.remove();
  if (naam === "2d") { mount(<Tekenvlak2D />); await wacht(200); return; }
  if (naam === "3d-boven") { await toon3D(ZICHT, "top", boven(4)); return; }
  if (naam === "3d-iso") { await toon3D({ ...ZICHT, perspective: true, viewCube: true }, "iso"); return; }
  if (naam === "3d-doos") {
    await toon3D({ ...ZICHT, perspective: true, sectionBox: { enabled: true, bounds: { min: [2, 0.5, -0.5], max: [4, 3.5, 4] } } }, "iso");
  }
}

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  document.documentElement.setAttribute("data-oa-theme", "light");
  const beeldNaam = /beeld=([\w-]+)/.exec(location.hash)?.[1];
  if (beeldNaam) { await toonBeeld(beeldNaam); return; }

  await test("3D: twee streep-stiplijnen (assen en levels), kleur en dekking als voorheen, schaal = px per meter", async () => {
    await toon3D(ZICHT, "top", boven(4));
    gelijk(tekenvlak().dataset.openFem3dProjection, "orthographic", "parallel");
    const lijnen = streepStipLijnen();
    gelijk(lijnen.length, 2, "assen op het basisniveau en de levelrechthoeken");
    const materialen = lijnen.map((l) => l.material as THREE.LineDashedMaterial);
    gelijk(materialen.map((m) => m.type), ["LineDashedMaterial", "LineDashedMaterial"], "type");
    gelijk(materialen.map((m) => m.color.getHex()).sort(), [0x7c8da0, 0x94a3b8].sort(), "kleuren");
    gelijk(materialen.map((m) => m.opacity), [0.85, 0.85], "dekking");
    // 8 m in beeld over 650 px.
    for (const m of materialen) bijna(m.scale, canvas3d().getBoundingClientRect().height / 8, 1e-6, "px per meter");
    // Assen: 2 × 6 m (x) + 2 × 8 m (y); levels: 2 × (8 + 6 + 8 + 6).
    const lengtes = lijnen.map((l) => {
      const d = l.geometry.getAttribute("lineDistance").array as Float32Array;
      let som = 0;
      for (let i = 1; i < d.length; i += 2) { gelijk(d[i - 1], 0, "elk lijnstuk begint op 0"); som += d[i]; }
      return Math.round(som * 1000) / 1000;
    }).sort((a, b) => a - b);
    gelijk(lengtes, [28, 56], "lijnlengte per laag (m)");
  });

  await test("3D, bovenaanzicht parallel: langs as A (x = 0) streep-stip 16-4-2-4 px, vanaf het begin van de lijn", async () => {
    await toon3D(ZICHT, "top", boven(4));
    controleerStreepStip(0, 0, 0.3, 3.7, "boven, 81 px/m");
  });

  await test("3D: tweemaal in- en uitgezoomd hetzelfde patroon in px (schermvast)", async () => {
    await toon3D(ZICHT, "top", boven(4));
    const lengte = () => Math.abs(scherm([0, 0.3, 0]).y - scherm([0, 3.7, 0]).y);
    const l1 = lengte();
    zetCamera(boven(2));
    await wacht(150);
    bijna(lengte() / l1, 2, 0.01, "ingezoomd: de as twee keer zo lang in beeld");
    controleerStreepStip(0, 0, 0.3, 3.7, "ingezoomd, 162 px/m");
    zetCamera(boven(8));
    await wacht(150);
    bijna(lengte() / l1, 0.5, 0.01, "uitgezoomd: half zo lang");
    controleerStreepStip(0, 0, 0.3, 3.7, "uitgezoomd, 41 px/m");
  });

  await test("3D, perspectief iso: schaal = px per meter bij het draaipunt; peilmaten één per level", async () => {
    await toon3D({ ...ZICHT, perspective: true }, "iso");
    gelijk(tekenvlak().dataset.openFem3dProjection, "perspective", "perspectief");
    const ds = tekenvlak().dataset;
    const vec = (s: string | undefined) => new THREE.Vector3(...(s ?? "0,0,0").split(",").map(Number));
    const afstand = vec(ds.openFem3dCameraPosition).distanceTo(vec(ds.openFem3dCameraTarget));
    const verwacht = canvas3d().getBoundingClientRect().height / (2 * afstand * Math.tan(THREE.MathUtils.degToRad(25)));
    for (const l of streepStipLijnen()) bijna((l.material as THREE.LineDashedMaterial).scale, verwacht, verwacht * 1e-6, "px per meter");
    info.push(`iso: ${verwacht.toFixed(1)} px/m bij ${afstand.toFixed(2)} m`);
    const peilmaten = [...container.querySelectorAll<HTMLElement>(".open-fem3d-level-mark")];
    gelijk(peilmaten.map((el) => el.dataset.openFem3dLevelMark), ["p0", "p3"], "één peilmaat per level");
    ok(peilmaten.every((el) => el.style.display !== "none"), "zichtbaar");
  });

  await test("3D, section box: staaf buiten de doos weg, het stramien heel en nog steeds streep-stip", async () => {
    await toon3D(ZICHT, "top", boven(4));
    const donker = (p: [number, number, number]) => {
      const { schaal, helderheid } = beeld();
      const s = scherm(p);
      let max = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) max = Math.max(max, 255 - helderheid(s.x * schaal + dx, s.y * schaal + dy));
      return max;
    };
    // Randligger y = 1 van x = 1 tot 5 op 3 m: links (x = 1,5) en midden (x = 3).
    ok(donker([1.5, 1, 3]) > 60 && donker([3, 1, 3]) > 60, "zonder doos: de ligger overal");
    zetZicht({ ...ZICHT, sectionBox: { enabled: true, bounds: { min: [2, 0.5, -0.5], max: [4, 3.5, 4] } } });
    await wacht(150);
    ok(Number(tekenvlak().dataset.openFem3dSectionBoxMaterialen) > 0, "de doos knipt materialen");
    ok(donker([1.5, 1, 3]) < 30, `buiten de doos weg (${donker([1.5, 1, 3])})`);
    ok(donker([3, 1, 3]) > 60, "binnen de doos staat hij er");
    for (const l of streepStipLijnen()) ok(!(l.material as THREE.Material).clippingPlanes?.length, "stramien zonder clipping planes");
    controleerStreepStip(0, 0, 0.3, 3.7, "met section box");
  });

  await test("2D: stramienassen en niveaulijnen streep-stip 16 4 2 4, kleur en dekking als voorheen", async () => {
    mount(<Tekenvlak2D />);
    await wacht(150);
    const lijnen = [...container.querySelectorAll<SVGLineElement>("line.fem-stramien-line")];
    gelijk(lijnen.length, 4, "twee assen en twee niveaus");
    const richting = lijnen.map((l) => (Math.abs(l.x1.baseVal.value - l.x2.baseVal.value) < 1e-6 ? "verticaal" : "horizontaal"));
    gelijk(richting.sort(), ["horizontaal", "horizontaal", "verticaal", "verticaal"], "assen en niveaus");
    for (const l of lijnen) {
      const s = getComputedStyle(l);
      gelijk(s.strokeDasharray, STRAMIEN_STREEPSTIP_PX.map((v) => `${v}px`).join(", "), "patroon");
      gelijk([s.stroke, s.strokeWidth, s.opacity], ["rgb(255, 176, 0)", "1px", "0.35"], "kleur, dikte, dekking");
    }
  });
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, info, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, info, error: String(e?.stack ?? e) }); });
