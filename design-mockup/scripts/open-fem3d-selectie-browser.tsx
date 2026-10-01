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
 *  - crossing (van rechts naar links) tegenover venster, met het getekende kader;
 *  - rechts slepen draait om het midden van de selectie;
 *  - Escape: uit het gereedschap, daarna selectie weg; Delete verwijdert een
 *    plaat met opening, Ctrl+Z (historie) zet haar terug.
 *
 * Zonder hash draait de testreeks; `#diag` telt alleen hoe vaak één klik op of
 * naast een staaf van de staalhal die staaf selecteert.
 */
import React, { useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as THREE from "three";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import OpenFem3DEditor from "../src/components/openFem3d/OpenFem3DEditor";
import {
  addOpenFem3DPlate, addOpenFem3DPlateOpening, addOpenFem3DSurfaceLoad, parseOpenFem3DModel, type OpenFem3DModel,
} from "../src/components/openFem3d/openFem3dModel";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DTool } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import { openFem3dHistoryReducer } from "../src/components/openFem3d/openFem3dHistory";
import type { OpenFem3DNodeTarget } from "../src/components/openFem3d/openFem3dNodeTools";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import {
  openFem3DAutoDeformationScale, type OpenFem3DDeformationDisplay,
} from "../src/components/openFem3d/openFem3dDeformationDisplay";
import OpenFem3DExplorer from "../src/components/openFem3d/OpenFem3DExplorer";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_STRUCTURAL_GRID } from "../src/components/fem/femTypes";
// @ts-expect-error -- esbuild laadt het projectbestand als tekst
import staalhalTekst from "../../docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden;
// de capture zelf is hier niet het onderwerp.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

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
  const start = performance.now();
  try { await fn(); tests.push({ name, ms: Math.round(performance.now() - start) }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - start) }); }
}

const staalhal: OpenFem3DModel = parseOpenFem3DModel(JSON.parse(staalhalTekst as string).model3d);
const snel: OpenFem3DVisibility = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, nodeNumbers: false, grid: false, structuralGrid: false };

// ── Het tekenvlak met eigen selectie- en gereedschapstoestand ──────────────
let selectie: OpenFem3DSelection = null;
let gereedschap: OpenFem3DTool = "select";
let zetGereedschap: (tool: OpenFem3DTool) => void = () => {};
let geplaatst: OpenFem3DNodeTarget[] = [];
function Tekenvlak({ model, visibility, activeLoadCaseId, camera, workPlaneZ, result, deformationDisplay }: {
  model: OpenFem3DModel; visibility: OpenFem3DVisibility; activeLoadCaseId?: number; camera?: OpenFem3DCameraState;
  workPlaneZ?: number; result?: OpenFem3DSolveResult | null; deformationDisplay?: OpenFem3DDeformationDisplay;
}) {
  const [sel, setSel] = useState<OpenFem3DSelection>(null);
  const [tool, setTool] = useState<OpenFem3DTool>("select");
  zetGereedschap = (next) => { gereedschap = next; setTool(next); };
  return <div className="open-fem3d-stage" style={{ width: BREED, height: HOOG, flex: "none" }}>
    <ThreeFrameCanvas
      model={model} onChange={() => {}} tool={tool} selection={sel}
      onSelect={(next) => { selectie = next; setSel(next); }}
      onToolChange={(next) => { gereedschap = next; setTool(next); }}
      onPlaceNodeCondition={(target) => { geplaatst.push(target); }}
      fitToken={0} visibility={visibility} activeLoadCaseId={activeLoadCaseId} workPlaneZ={workPlaneZ}
      result={result} deformationDisplay={deformationDisplay}
      cameraRequest={camera ? { state: camera, token: 1 } : undefined}
    />
  </div>;
}
async function toon(model: OpenFem3DModel, visibility: OpenFem3DVisibility, extra: {
  activeLoadCaseId?: number; camera?: OpenFem3DCameraState; workPlaneZ?: number;
  result?: OpenFem3DSolveResult | null; deformationDisplay?: OpenFem3DDeformationDisplay;
} = {}) {
  selectie = null;
  gereedschap = "select";
  mount(<Tekenvlak model={model} visibility={visibility} {...extra} />);
  await wacht(200);
}

const canvasEl = () => container.querySelector("canvas") as HTMLCanvasElement;
const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;
const kaderEl = () => container.querySelector(".open-fem3d-selection-box") as HTMLDivElement;
function camera(): THREE.PerspectiveCamera {
  const ds = tekenvlakEl().dataset;
  const vec = (s: string | undefined) => new THREE.Vector3(...(s ?? "0,0,0").split(",").map(Number));
  const cam = new THREE.PerspectiveCamera(50, BREED / HOOG, 0.01, 100000);
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
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  // Alleen een beeld (voor een schermafbeelding): de vervormde vorm van dichtbij.
  if (location.hash === "#beeld=vervormd") {
    document.getElementById("uitslag")!.remove();
    await toon(vervormModel, vervormZicht, { result: vervormResultaat,
      camera: { position: [7.5, -4.2, 2.6], target: [3, 1.2, -0.2], up: [0, 0, 1] } });
    return;
  }
  if (location.hash === "#diag") {
    const uitkomst = await diagnose();
    document.getElementById("uitslag")!.textContent = JSON.stringify({ diag: uitkomst, tests: [], error: null });
    return;
  }

  // Twee groepen, elk in een eigen browserproces: de staalhal (veel klikken,
  // zware scène in SwiftShader) en de kleine modellen.
  const groep = /groep=(\w+)/.exec(location.hash)?.[1] ?? "alles";
  if (groep === "alles" || groep === "groot") await grootModel();
  if (groep === "alles" || groep === "klein") await kleineModellen();
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

}

async function kleineModellen() {
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
    document.documentElement.setAttribute("data-theme", "openaec");
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
      document.documentElement.removeAttribute("data-theme");
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

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });
