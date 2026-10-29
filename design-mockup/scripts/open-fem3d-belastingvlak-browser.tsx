/**
 * Browserkant van test-open-fem3d-belastingvlak-ui.mjs: belastingvlakken en
 * oppervlaktelasten in de echte 3D-werkruimte (OpenFem3DEditor met
 * ThreeFrameCanvas, WebGL), met echte klikken op het tekenvlak.
 *
 * Bewaakt: een nieuw getekend belastingvlak landt op het actieve werkvlak
 * (level), in boven- en scheef aanzicht; het licht doorzichtige vlak in de
 * kleur van het belastinggeval, alleen bij zichtbare belastingen en het
 * actieve geval, ook van onderen; klikken door het vlak heen (een ligger in
 * het vlak en de plaat onder een oppervlaktelast blijven aanklikbaar, een
 * plaat ver onder het vlak niet) en het label in licht en donker thema.
 *
 * De uitslag komt als JSON in #uitslag.
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
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DTool } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { StructuralGrid } from "../src/components/fem/femTypes";

// De WebGL-buffer bewaren, zodat de test de pixels van het 3D-beeld kan lezen.
const eigenGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, soort: string, opties?: Record<string, unknown>) {
  if (soort === "webgl" || soort === "webgl2") opties = { ...(opties ?? {}), preserveDrawingBuffer: true };
  return (eigenGetContext as (s: string, o?: unknown) => RenderingContext | null).call(this, soort, opties);
} as typeof HTMLCanvasElement.prototype.getContext;

const tests: { name: string; error?: string }[] = [];
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
}

// ── Model: een vak van 6 × 4 m, vier kolommen, randliggers op 3 m ─────────
const LEVELS = [
  { id: "peil0", label: "Peil 0", position: 0 },
  { id: "v1", label: "1e verdieping", position: 3000 },
];
const GRID: StructuralGrid = { enabled: true, xAxes: [], yAxes: [], zAxes: LEVELS };
/** Soort per belastinggeval: 1 permanent, 2 sneeuw (cyaan). */
const TYPES: ReadonlyMap<number, string> = new Map([[1, "dead"], [2, "snow"]]);
const LEEG = { supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [] };

function vak(): OpenFem3DModel {
  return parseOpenFem3DModel({
    ...LEEG,
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
      { id: 5, x: 0, y: 0, z: 3 }, { id: 6, x: 6, y: 0, z: 3 }, { id: 7, x: 6, y: 4, z: 3 }, { id: 8, x: 0, y: 4, z: 3 },
    ],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 5 }, { id: 2, startNodeId: 2, endNodeId: 6 },
      { id: 3, startNodeId: 3, endNodeId: 7 }, { id: 4, startNodeId: 4, endNodeId: 8 },
      { id: 5, startNodeId: 5, endNodeId: 6 }, { id: 6, startNodeId: 6, endNodeId: 7 },
      { id: 7, startNodeId: 7, endNodeId: 8 }, { id: 8, startNodeId: 8, endNodeId: 5 },
    ].map((beam) => ({ ...beam, profileName: "HEA 200", material: "S235" })),
    plates: [], surfaceLoads: [],
  });
}

/**
 * Een dak op 3 m met een middenligger (staaf 11, x = 3 m) en een belastingvlak
 * (sneeuw) over het hele vak, boven een vloerplaat op peil 0 met een
 * oppervlaktelast in hetzelfde geval.
 */
function dakEnVloer(): OpenFem3DModel {
  return parseOpenFem3DModel({
    ...LEEG,
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
      { id: 5, x: 0, y: 0, z: 3 }, { id: 6, x: 3, y: 0, z: 3 }, { id: 7, x: 6, y: 0, z: 3 },
      { id: 8, x: 6, y: 4, z: 3 }, { id: 9, x: 3, y: 4, z: 3 }, { id: 10, x: 0, y: 4, z: 3 },
    ],
    beams: [
      { id: 1, startNodeId: 1, endNodeId: 5 }, { id: 2, startNodeId: 2, endNodeId: 7 },
      { id: 3, startNodeId: 3, endNodeId: 8 }, { id: 4, startNodeId: 4, endNodeId: 10 },
      { id: 5, startNodeId: 5, endNodeId: 6 }, { id: 6, startNodeId: 6, endNodeId: 7 },
      { id: 7, startNodeId: 7, endNodeId: 8 }, { id: 8, startNodeId: 8, endNodeId: 9 },
      { id: 9, startNodeId: 9, endNodeId: 10 }, { id: 10, startNodeId: 10, endNodeId: 5 },
      { id: 11, startNodeId: 6, endNodeId: 9 },
    ].map((beam) => ({ ...beam, profileName: "HEA 200", material: "S235" })),
    plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.2, material: "C30/37" }],
    surfaceLoads: [{ id: 1, plateId: 1, caseId: 2, qx: 0, qy: 0, qz: -3 }],
    loadPanels: [{
      id: 1, nodeIds: [5, 7, 8, 10], caseId: 2, q: 2, direction: "gravity", distribution: "oneWay",
      spanDirection: { x: 1, y: 0, z: 0 },
    }],
  });
}

const ZICHT: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY,
  grid: false, axes: false, structuralGrid: false, nodeNumbers: false, supports: false,
  deformation: false, reactions: false, utilization: false,
};
/** Recht van boven op het vak (x naar rechts, y naar boven in beeld). */
const BOVEN: OpenFem3DCameraState = { position: [3, 2, 20], target: [3, 2, 3], up: [0, 1, 0] };
/** Van onderen, recht omhoog: het vlak moet ook aan de onderzijde zichtbaar zijn. */
const ONDER: OpenFem3DCameraState = { position: [3, 2, -14], target: [3, 2, 3], up: [0, 1, 0] };
/**
 * Voor het tekenen: het richtpunt van de camera op 1,5 m, dus op geen van
 * beide levels. Een klik in leeg canvas mag daar niet landen (zo deed het
 * tekenvlak het vóór de werkvlakken), maar op het gekozen werkvlak.
 */
const TEKEN_BOVEN: OpenFem3DCameraState = { position: [3, 2, 20], target: [3, 2, 1.5], up: [0, 1, 0] };
/** Scheef (isometrisch), dicht genoeg bij dat de hoeken ruim buiten elkaars snapzone liggen. */
const TEKEN_SCHEEF: OpenFem3DCameraState = { position: [10, -5, 9], target: [3, 2, 1.5], up: [0, 0, 1] };

interface Stand { model: OpenFem3DModel; selectie: OpenFem3DSelection; tool: OpenFem3DTool }
let stand: Stand;
let zet: {
  model: (m: OpenFem3DModel) => void; zicht: (v: OpenFem3DVisibility) => void; geval: (id: number) => void;
  tool: (t: OpenFem3DTool) => void; selectie: (s: OpenFem3DSelection) => void;
};
function Werkruimte({ begin, camera, geval = 2 }: { begin: OpenFem3DModel; camera: OpenFem3DCameraState; geval?: number }) {
  const [m, setM] = React.useState(begin);
  const [v, setV] = React.useState(ZICHT);
  const [g, setG] = React.useState(geval);
  const [t, setT] = React.useState<OpenFem3DTool>("select");
  const [s, setS] = React.useState<OpenFem3DSelection>(null);
  stand = { model: m, selectie: s, tool: t };
  zet = { model: setM, zicht: setV, geval: setG, tool: setT, selectie: setS };
  return (
    <div style={{ width: 800, height: 500, position: "relative", display: "flex" }}>
      <OpenFem3DEditor model={m} onChange={(next) => setM(next)} visibility={v} onVisibilityChange={setV}
        tool={t} onToolChange={setT} selection={s} onSelectionChange={setS}
        showLoadCase activeLoadCaseId={g} loadCaseTypes={TYPES} structuralGrid={GRID}
        initialCamera={camera} />
    </div>
  );
}

const tekenvlak = () => container.querySelector<HTMLElement>(".open-fem3d-canvas")!;
const canvas3d = () => container.querySelector<HTMLCanvasElement>(".open-fem3d-canvas canvas")!;

/** Schermpunt (clientX/Y) van een wereldpunt, met de camera die het tekenvlak meldt. */
function naarScherm(p: [number, number, number]): { x: number; y: number } {
  const data = tekenvlak().dataset;
  const lees = (waarde: string | undefined) => {
    ok(waarde, "camerastand ontbreekt op het tekenvlak");
    return waarde!.split(",").map(Number) as [number, number, number];
  };
  const rect = canvas3d().getBoundingClientRect();
  const camera = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.01, 1000);
  camera.position.fromArray(lees(data.openFem3dCameraPosition));
  camera.up.fromArray(lees(data.openFem3dCameraUp));
  camera.lookAt(new THREE.Vector3(...lees(data.openFem3dCameraTarget)));
  camera.updateMatrixWorld();
  const ndc = new THREE.Vector3(...p).project(camera);
  return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
}

/** Een echte klik (pointerdown + pointerup op dezelfde plek) op het WebGL-canvas. */
function klikOp(p: [number, number, number]) {
  const canvas = canvas3d();
  // Synthetische aanwijzers hebben geen echte capture; OrbitControls en het
  // selectiekader vragen die wel aan.
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  const { x, y } = naarScherm(p);
  const basis = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y };
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointermove", { ...basis, button: -1, buttons: 0 })));
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointerdown", { ...basis, button: 0, buttons: 1 })));
  flushSync(() => canvas.dispatchEvent(new PointerEvent("pointerup", { ...basis, button: 0, buttons: 0 })));
}

/**
 * Gemiddelde van (blauw − rood) in een venster rond een wereldpunt. Wit en
 * grijs geven 0; het cyaan van sneeuw (#06b6d4) op 20 % over wit geeft ~40.
 */
function tint(p: [number, number, number], half = 10): number {
  const bron = canvas3d();
  const rect = bron.getBoundingClientRect();
  const schaal = bron.width / rect.width;
  const { x, y } = naarScherm(p);
  const doek = document.createElement("canvas");
  doek.width = bron.width; doek.height = bron.height;
  const ctx = doek.getContext("2d")!;
  ctx.drawImage(bron, 0, 0);
  const cx = Math.round((x - rect.left) * schaal), cy = Math.round((y - rect.top) * schaal);
  const data = ctx.getImageData(cx - half, cy - half, 2 * half + 1, 2 * half + 1).data;
  let som = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { som += data[i + 2] - data[i]; n += 1; }
  return som / n;
}

function contrast(voor: string, achter: string): number {
  const kanaal = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (css: string) => {
    const [r, g, b] = (css.match(/[\d.]+/g) ?? []).map(Number);
    return 0.2126 * kanaal(r) + 0.7152 * kanaal(g) + 0.0722 * kanaal(b);
  };
  const [a, b] = [lum(voor), lum(achter)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  document.documentElement.setAttribute("data-oa-theme", "light");

  // ── Tekenen op het werkvlak ─────────────────────────────────────────────
  async function tekenVlak(camera: OpenFem3DCameraState, level: string, z: number,
    hoeken: [number, number][] = [[1, 1], [5, 1], [5, 3], [1, 3]]) {
    mount(<Werkruimte begin={vak()} camera={camera} geval={2} />);
    await wacht(300);
    const keuze = container.querySelector<HTMLSelectElement>(".open-fem3d-workplane select");
    ok(keuze, "keuzelijst Werkvlak ontbreekt");
    flushSync(() => {
      keuze!.value = level;
      keuze!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    gelijk(container.querySelector<HTMLElement>(".open-fem3d-workplane")!.dataset.openFem3dWorkPlaneZ, String(z), "werkvlak in de kop");
    flushSync(() => zet.tool("addLoadPanel"));
    await wacht(100);
    const aantalKnopen = stand.model.nodes.length;
    for (const [index, [x, y]] of hoeken.entries()) {
      klikOp([x, y, z]);
      if (index === 0) {
        // De eerste klik in leeg canvas bepaalt het vlak: het werkvlak. Daarna
        // blijft de contour in het vlak van dat eerste punt.
        gelijk(tekenvlak().dataset.openFem3dDrawingPlaneSource, "level", "bron van het tekenvlak bij de eerste klik");
        gelijk(Number(tekenvlak().dataset.openFem3dDrawingPlaneZ), z, "hoogte van het tekenvlak");
      }
      await wacht(60);
    }
    klikOp([hoeken[0][0], hoeken[0][1], z]);
    await wacht(150);
    const vlakken = stand.model.loadPanels ?? [];
    gelijk(vlakken.length, 1, "één nieuw belastingvlak");
    const vlak = vlakken[0];
    gelijk(stand.model.nodes.length, aantalKnopen + 4, "vier nieuwe hoekknopen");
    const knopen = vlak.nodeIds.map((id) => stand.model.nodes.find((node) => node.id === id)!);
    for (const knoop of knopen) ok(Math.abs(knoop.z - z) < 1e-9, `knoop ${knoop.id} op z = ${knoop.z} m, niet op het werkvlak ${z} m`);
    gelijk(knopen.map((knoop) => [knoop.x, knoop.y].map((w) => Math.round(w * 1000) / 1000)), hoeken, "hoeken van het vlak");
    gelijk(vlak.caseId, 2, "belastinggeval van het nieuwe vlak = het actieve geval");
    gelijk(stand.selectie, { type: "loadPanel", id: vlak.id }, "het nieuwe vlak is geselecteerd");
  }
  await test("tekenen: een nieuw belastingvlak landt op het actieve werkvlak (1e verdieping, 3 m) in bovenaanzicht", async () => {
    await tekenVlak(TEKEN_BOVEN, "v1", 3);
  });
  await test("tekenen: met Peil 0 als werkvlak landt hetzelfde vlak op z = 0", async () => {
    await tekenVlak(TEKEN_BOVEN, "peil0", 0);
  });
  await test("tekenen: in een scheef aanzicht landt een klik in leeg canvas ook op het werkvlak (3 m)", async () => {
    await tekenVlak(TEKEN_SCHEEF, "v1", 3, [[1.5, 1.5], [4.5, 1.5], [4.5, 2.5], [1.5, 2.5]]);
  });
  await test("schilpaneel: tekenen op knopen, selecteren en zichtbaarheidslaag", async () => {
    mount(<Werkruimte begin={vak()} camera={BOVEN} geval={2} />);
    await wacht(300);
    flushSync(() => zet.tool("addEnvelopePanel"));
    await wacht(80);
    for (const point of [[0, 0, 3], [6, 0, 3], [6, 4, 3], [0, 4, 3], [0, 0, 3]] as [number, number, number][]) {
      klikOp(point);
      await wacht(65);
    }
    gelijk(stand.model.envelopePanels?.length, 1, "één schilpaneel");
    gelijk(stand.model.envelopePanels?.[0].type, "roof", "horizontaal vlak is dak");
    gelijk(stand.selectie, { type: "envelopePanel", id: 1 }, "nieuw paneel geselecteerd");
    flushSync(() => zet.tool("select"));
    await wacht(80);
    klikOp([2, 2, 3]);
    await wacht(80);
    gelijk(stand.selectie, { type: "envelopePanel", id: 1 }, "vlak aanklikbaar");
    flushSync(() => zet.zicht({ ...ZICHT, envelopePanels: false }));
    await wacht(80);
    klikOp([2, 2, 3]);
    await wacht(80);
    ok(stand.selectie?.type !== "envelopePanel", "verborgen paneel niet aanklikbaar");
  });

  // ── Het licht doorzichtige vlak ─────────────────────────────────────────
  const leeg: [number, number, number] = [1.5, 2, 3];
  const buiten: [number, number, number] = [8.5, 2, 3];
  const zonderVloer = () => ({ ...dakEnVloer(), plates: [], surfaceLoads: [] });
  await test("vlak: licht doorzichtig in de kleur van het belastinggeval; weg bij een ander geval of zonder lasten", async () => {
    mount(<Werkruimte begin={zonderVloer()} camera={BOVEN} geval={2} />);
    await wacht(300);
    const aan = tint(leeg);
    const achtergrond = tint(buiten);
    ok(aan > 15, `geen cyaan tint in het vlak: ${aan.toFixed(1)}`);
    ok(Math.abs(achtergrond) < 3, `achtergrond is niet wit: ${achtergrond.toFixed(1)}`);
    ok(container.querySelector(".open-fem3d-load-panel-label"), "label van het belastingvlak ontbreekt");
    flushSync(() => zet.geval(1));
    await wacht(200);
    const anderGeval = tint(leeg);
    ok(anderGeval < aan - 12, `vlak blijft zichtbaar bij een ander belastinggeval: ${anderGeval.toFixed(1)} (was ${aan.toFixed(1)})`);
    ok(!container.querySelector(".open-fem3d-load-panel-label"), "label blijft staan bij een ander belastinggeval");
    flushSync(() => zet.geval(2));
    await wacht(200);
    ok(tint(leeg) > 15, "vlak komt niet terug bij het eigen geval");
    flushSync(() => zet.zicht({ ...ZICHT, loads: false }));
    await wacht(200);
    ok(tint(leeg) < aan - 12, "vlak blijft zichtbaar zonder belastingen");
    flushSync(() => zet.zicht({ ...ZICHT, loadPanels: false }));
    await wacht(200);
    const zonderVlakken = tint(leeg);
    ok(zonderVlakken < aan - 5, `belastingvlak blijft zichtbaar met de laag Belastingvlakken uit: ${zonderVlakken.toFixed(1)}`);
    ok(!container.querySelector(".open-fem3d-load-panel-label"), "label blijft staan met de laag Belastingvlakken uit");
  });
  await test("vlak: dubbelzijdig, ook van onderen zichtbaar", async () => {
    mount(<Werkruimte begin={zonderVloer()} camera={ONDER} geval={2} />);
    await wacht(300);
    const onder = tint(leeg);
    ok(onder > 15, `vlak van onderen niet zichtbaar: ${onder.toFixed(1)}`);
  });
  await test("vlak: ook de oppervlaktelast op een plaat krijgt een gekleurd vlak, alleen bij het actieve geval", async () => {
    mount(<Werkruimte begin={dakEnVloer()} camera={BOVEN} geval={2} />);
    flushSync(() => zet.zicht({ ...ZICHT, loadPanels: false }));
    await wacht(300);
    const vloer: [number, number, number] = [1.5, 2, 0.11];
    const aan = tint(vloer);
    flushSync(() => zet.geval(1));
    await wacht(200);
    const uit = tint(vloer);
    ok(aan > uit + 8, `geen tint van de oppervlaktelast: ${aan.toFixed(1)} tegen ${uit.toFixed(1)} zonder`);
  });

  // ── Klikken door het vlak heen ──────────────────────────────────────────
  await test("klikken: de middenligger in het vlak blijft aanklikbaar, een leeg deel selecteert het vlak", async () => {
    mount(<Werkruimte begin={dakEnVloer()} camera={BOVEN} geval={2} />);
    await wacht(300);
    klikOp([3, 2, 3]);
    await wacht(80);
    gelijk(stand.selectie, { type: "beam", id: 11 }, "klik op de middenligger");
    klikOp([1.5, 2, 3]);
    await wacht(80);
    // Onder dit punt ligt 3 m lager de vloerplaat: die ligt ver achter het
    // vlak en steelt de klik niet.
    gelijk(stand.selectie, { type: "loadPanel", id: 1 }, "klik op een leeg deel van het vlak");
    klikOp([4.5, 1, 3]);
    await wacht(80);
    gelijk(stand.selectie, { type: "loadPanel", id: 1 }, "klik op het andere veld");
    klikOp([0, 0, 3]);
    await wacht(80);
    gelijk(stand.selectie, { type: "node", id: 5 }, "klik op een hoekknoop");
  });
  await test("klikken: bij een ander belastinggeval is het vlak niet aanklikbaar", async () => {
    mount(<Werkruimte begin={zonderVloer()} camera={BOVEN} geval={1} />);
    await wacht(300);
    klikOp([1.5, 2, 3]);
    await wacht(80);
    ok(stand.selectie?.type !== "loadPanel", `onzichtbaar vlak geselecteerd: ${JSON.stringify(stand.selectie)}`);
  });
  await test("klikken: de plaat onder een oppervlaktelast blijft aanklikbaar", async () => {
    mount(<Werkruimte begin={dakEnVloer()} camera={BOVEN} geval={2} />);
    flushSync(() => zet.zicht({ ...ZICHT, loadPanels: false }));
    await wacht(300);
    klikOp([1.5, 2, 0.11]);
    await wacht(80);
    gelijk(stand.selectie, { type: "plate", id: 1 }, "klik op de vloer met oppervlaktelast");
  });

  // ── Label in licht en donker thema ──────────────────────────────────────
  await test("label: leesbaar in het lichte en het donkere thema (contrast ≥ 4,5)", async () => {
    for (const thema of ["light", "dark"]) {
      document.documentElement.setAttribute("data-oa-theme", thema);
      mount(<Werkruimte begin={dakEnVloer()} camera={BOVEN} geval={2} />);
      await wacht(300);
      const label = container.querySelector<HTMLElement>(".open-fem3d-load-panel-label");
      ok(label, `${thema}: label ontbreekt`);
      const stijl = getComputedStyle(label!);
      const verhouding = contrast(stijl.color, stijl.backgroundColor);
      ok(verhouding >= 4.5, `${thema}: contrast ${verhouding.toFixed(2)} (${stijl.color} op ${stijl.backgroundColor})`);
      const achtergrond = tint(buiten);
      ok(Math.abs(achtergrond) < 3, `${thema}: 3D-achtergrond niet wit (${achtergrond.toFixed(1)})`);
      ok(tint(leeg) > 15, `${thema}: vlak niet zichtbaar`);
    }
    document.documentElement.setAttribute("data-oa-theme", "light");
  });
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });
