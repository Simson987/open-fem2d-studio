/**
 * Browserkant van test-open-fem3d-peilmaten-ui.mjs: het echte 3D-tekenvlak
 * (ThreeFrameCanvas, WebGL) met de peilmaten bij de levels (issue #92), in
 * een lokale headless browser van 1000 × 650 px.
 *
 *  - stramien uit, peilmaten aan: per level één label met de tekst van 2D
 *    (`niveauLabel`), geen stramienlabels en geen kale levelnaam;
 *  - peilmaten uit: het snelle pad "level-marks-visibility", de labels weg;
 *    weer aan: terug, zonder volledige opbouw;
 *  - in iso-, voor- en zijaanzicht (perspectief en parallel), na passend
 *    beeld: de punt van het driehoekje ligt op ±1 px van de projectie van de
 *    hoek van de modelrand die op het scherm links ligt (verschoven met
 *    `openFem3DPeilmaatPuntPx`), het label kruist geen enkele staaf, en het
 *    hele label (tekst en driehoekje) ligt in beeld — ook bij de hal van
 *    30 m in vooraanzicht;
 *  - gedraaid naar achter: de peilmaat hangt aan de andere kant;
 *  - het label is niet breder dan de schatting waarmee passend beeld ruimte
 *    maakt.
 *
 * De camera wordt nagebouwd uit de diagnose van het tekenvlak (zoals in
 * open-fem3d-selectie-browser.tsx).
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as THREE from "three";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import { parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DView } from "../src/components/openFem3d/openFem3dCommands";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { GridAxisLine, StructuralGrid } from "../src/components/fem/femTypes";
import { niveauLabel } from "../src/lib/peilmaat";
import {
  openFem3DPeilmaatBreedtePx, openFem3DPeilmaatHoek, openFem3DPeilmaatPuntPx, type OpenFem3DPunt,
} from "../src/components/openFem3d/openFem3dPeilmaten";

const BREED = 1000, HOOG = 650;
const tests: { name: string; error?: string }[] = [];
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
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}

/* ── Modellen ─────────────────────────────────────────────────────────── */

function bouwer() {
  const nodes: { id: number; x: number; y: number; z: number }[] = [];
  const beams: { id: number; startNodeId: number; endNodeId: number; profileName: string; material: string }[] = [];
  const ids = new Map<string, number>();
  const knoop = (x: number, y: number, z: number) => {
    const sleutel = `${x},${y},${z}`;
    if (!ids.has(sleutel)) { ids.set(sleutel, nodes.length + 1); nodes.push({ id: nodes.length + 1, x, y, z }); }
    return ids.get(sleutel)!;
  };
  const staaf = (a: number, b: number, profileName: string) =>
    beams.push({ id: beams.length + 1, startNodeId: a, endNodeId: b, profileName, material: "S235" });
  return { knoop, staaf, model: () => parseOpenFem3DModel({ nodes, beams, supports: [], loads: [] }) };
}

/** Hal van 30 × 12 m, kolommen 6 m hoog om de 6 m, spanten over 12 m, randliggers. */
const hal: OpenFem3DModel = (() => {
  const { knoop, staaf, model } = bouwer();
  for (const x of [0, 6, 12, 18, 24, 30]) {
    for (const y of [0, 12]) staaf(knoop(x, y, 0), knoop(x, y, 6), "HEA 200");
    staaf(knoop(x, 0, 6), knoop(x, 12, 6), "IPE 300");
  }
  for (const y of [0, 12]) for (let x = 0; x < 30; x += 6) staaf(knoop(x, y, 6), knoop(x + 6, y, 6), "IPE 200");
  return model();
})();
const HAL_LEVELS: GridAxisLine[] = [
  { id: "1", label: "1", position: 0 },
  { id: "kop", label: "kolomkop", position: 6000 },
];

/** Portaal van 6 × 4 m, twee verdiepingen van 3,5 m. */
const portaal: OpenFem3DModel = (() => {
  const { knoop, staaf, model } = bouwer();
  const hoeken: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
  for (const [x, y] of hoeken) {
    staaf(knoop(x, y, 0), knoop(x, y, 3.5), "HEA 200");
    staaf(knoop(x, y, 3.5), knoop(x, y, 7), "HEA 200");
  }
  for (const z of [3.5, 7]) {
    hoeken.forEach(([x, y], i) => {
      const [x2, y2] = hoeken[(i + 1) % hoeken.length];
      staaf(knoop(x, y, z), knoop(x2, y2, z), "IPE 240");
    });
  }
  return model();
})();
const PORTAAL_LEVELS: GridAxisLine[] = [
  { id: "1", label: "1", position: 0 },
  { id: "v1", label: "1e verdieping", position: 3500 },
  { id: "3", label: "3", position: 7000 },
];

const stramien = (levels: GridAxisLine[]): StructuralGrid => ({ enabled: true, xAxes: [], yAxes: [], zAxes: levels });

/* ── Opstelling ───────────────────────────────────────────────────────── */

// Eén vaste lege lijst: de standaardwaarde `utilizations = []` is elke render
// een nieuwe lijst, en dan neemt het tekenvlak nooit een snel pad.
const GEEN_BENUTTINGEN: never[] = [];
let zetZicht: (zicht: OpenFem3DVisibility) => void = () => {};
let zetCamera: (camera: OpenFem3DCameraState) => void = () => {};
function Tekenvlak({ model, grid, zicht: beginZicht, view }: {
  model: OpenFem3DModel; grid: StructuralGrid; zicht: OpenFem3DVisibility; view: OpenFem3DView;
}) {
  const [zicht, setZicht] = useState(beginZicht);
  const [cameraVerzoek, setCameraVerzoek] = useState<{ state: OpenFem3DCameraState; token: number } | undefined>();
  zetZicht = (next) => flushSync(() => setZicht(next));
  zetCamera = (state) => flushSync(() => setCameraVerzoek((vorig) => ({ state, token: (vorig?.token ?? 0) + 1 })));
  return <div className="open-fem3d-stage" style={{ width: BREED, height: HOOG, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={null} onSelect={() => {}}
      fitToken={0} visibility={zicht} structuralGrid={grid} viewRequest={{ kind: view, token: 1 }}
      utilizations={GEEN_BENUTTINGEN} cameraRequest={cameraVerzoek} />
  </div>;
}
async function toon(model: OpenFem3DModel, grid: StructuralGrid, zicht: OpenFem3DVisibility, view: OpenFem3DView = "iso") {
  mount(<Tekenvlak model={model} grid={grid} zicht={zicht} view={view} />);
  await wacht(250);
}

const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;
const peilmaatEls = () => [...container.querySelectorAll<HTMLElement>(".open-fem3d-level-mark")];
const zichtbaar = (el: HTMLElement) => el.style.display !== "none" && getComputedStyle(el).display !== "none";

/** De camera van het tekenvlak, nagebouwd uit zijn diagnose. */
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
/** Schermpunt in px binnen het tekenvlak. */
function scherm(cam: THREE.Camera, p: readonly [number, number, number]): Pt {
  const n = new THREE.Vector3(...p).project(cam);
  return { x: (n.x + 1) * BREED / 2, y: (1 - n.y) * HOOG / 2 };
}
/** De hoek waaraan de peilmaat volgens de zuivere regel hoort te hangen, met deze camera. */
function verwachteHoek(cam: THREE.Camera, el: HTMLElement): OpenFem3DPunt {
  const [xMin, xMax, yMin, yMax] = el.dataset.openFem3dLevelMarkRand!.split(",").map(Number);
  const z = Number(el.dataset.openFem3dLevelMarkZ);
  const hoeken: OpenFem3DPunt[] = [[xMin, yMin, z], [xMax, yMin, z], [xMax, yMax, z], [xMin, yMax, z]];
  const vooruit = cam.getWorldDirection(new THREE.Vector3());
  const index = openFem3DPeilmaatHoek(hoeken, (p) => {
    const diepte = new THREE.Vector3(...p).sub(cam.position).dot(vooruit);
    return { x: new THREE.Vector3(...p).project(cam).x, diepte };
  });
  return hoeken[index];
}
/** Rechthoek van een element binnen het tekenvlak (px). */
function vak(el: Element) {
  const basis = tekenvlakEl().getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { left: r.left - basis.left, right: r.right - basis.left, top: r.top - basis.top, bottom: r.bottom - basis.top };
}
/** Kruist het lijnstuk a–b de rechthoek? (Liang–Barsky) */
function kruist(a: Pt, b: Pt, r: { left: number; right: number; top: number; bottom: number }): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.left], [dx, r.right - a.x], [-dy, a.y - r.top], [dy, r.bottom - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Elke peilmaat in deze camerastand: aan de linker hoek van de rand, de punt
 * van het driehoekje op ±1 px van zijn projectie plus `openFem3DPeilmaatPuntPx`,
 * geen staaf door het label en het hele label in beeld.
 */
function controleerPlaats(model: OpenFem3DModel, wat: string) {
  const cam = camera();
  const els = peilmaatEls();
  ok(els.length > 0, `${wat}: peilmaten getekend`);
  const knopen = new Map(model.nodes.map((n) => [n.id, [n.x, n.y, n.z] as const]));
  const staven = model.beams.map((b) => [scherm(cam, knopen.get(b.startNodeId)!), scherm(cam, knopen.get(b.endNodeId)!)] as const);
  const verschuiving = openFem3DPeilmaatPuntPx();
  for (const el of els) {
    const naam = `${wat}, ${el.dataset.openFem3dLevelMark}`;
    ok(zichtbaar(el), `${naam}: zichtbaar`);
    const hoek = scherm(cam, verwachteHoek(cam, el));
    const driehoek = el.querySelector(".open-fem3d-level-mark-driehoek")!.getBoundingClientRect();
    const basis = tekenvlakEl().getBoundingClientRect();
    const punt = { x: driehoek.left + driehoek.width / 2 - basis.left, y: driehoek.bottom - basis.top };
    const verwacht = { x: hoek.x + verschuiving.x, y: hoek.y + verschuiving.y };
    ok(Math.abs(punt.x - verwacht.x) <= 1 && Math.abs(punt.y - verwacht.y) <= 1,
      `${naam}: punt op (${punt.x.toFixed(1)}, ${punt.y.toFixed(1)}), verwacht (${verwacht.x.toFixed(1)}, ${verwacht.y.toFixed(1)})`);
    // Het label zonder de vrije ruimte naar het model: tekst, driehoekje en streepje.
    const tekst = vak(el.querySelector(".open-fem3d-level-mark-tekst")!);
    const peil = vak(el.querySelector(".open-fem3d-level-mark-peil")!);
    const label = { left: tekst.left, right: peil.right, top: Math.min(tekst.top, peil.top), bottom: Math.max(tekst.bottom, peil.bottom) };
    const staaf = staven.findIndex(([a, b]) => kruist(a, b, label));
    ok(staaf < 0, `${naam}: staaf ${staaf + 1} loopt door het label (${JSON.stringify(label)})`);
    ok(label.left >= 0 && label.right <= BREED && label.top >= 0 && label.bottom <= HOOG,
      `${naam}: label buiten beeld (${label.left.toFixed(1)} … ${label.right.toFixed(1)} × ${label.top.toFixed(1)} … ${label.bottom.toFixed(1)})`);
  }
}

const standaard: OpenFem3DVisibility = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, grid: false, axes: false };
const parallel = (zicht: OpenFem3DVisibility): OpenFem3DVisibility => ({ ...zicht, perspective: false });

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });

  await test("stramien uit, peilmaten aan: per level één peilmaat met de tekst van 2D, geen stramienlabels", async () => {
    await toon(portaal, stramien(PORTAAL_LEVELS), { ...standaard, structuralGrid: false, levelMarks: true });
    const els = peilmaatEls();
    gelijk(els.map((el) => el.dataset.openFem3dLevelMark), PORTAAL_LEVELS.map((l) => l.id), "één per level");
    gelijk(els.map((el) => el.querySelector(".open-fem3d-level-mark-tekst")?.textContent),
      PORTAAL_LEVELS.map((l) => niveauLabel(l.label, l.position)), "tekst van niveauLabel");
    gelijk(els.map((el) => el.textContent), ["±0,00 m", "1e verdieping  +3,50 m", "+7,00 m"], "zoals in 2D");
    ok(els.every(zichtbaar), "alle zichtbaar");
    gelijk(container.querySelectorAll(".open-fem3d-grid-label").length, 0, "geen stramienlabels");
    ok(els.every((el) => el.querySelector("polygon.open-fem3d-level-mark-driehoek") && el.querySelector("line.open-fem3d-level-mark-streep")),
      "driehoekje en streepje in elk label");
  });

  await test("stramien en peilmaten aan: de peilmaat vervangt de kale levelnaam (geen dubbele tekst)", async () => {
    await toon(portaal, stramien(PORTAAL_LEVELS), { ...standaard });
    gelijk(peilmaatEls().length, PORTAAL_LEVELS.length, "één peilmaat per level");
    gelijk(container.querySelectorAll(".open-fem3d-level-label").length, 0, "geen kale levellabels");
    const teksten = [...container.querySelectorAll(".open-fem3d-grid-label")].map((el) => el.textContent);
    ok(!teksten.includes("1e verdieping"), `geen levelnaam als stramienlabel: ${JSON.stringify(teksten)}`);
  });

  await test("peilmaten uit: snel pad level-marks-visibility, labels weg; weer aan: terug", async () => {
    await toon(portaal, stramien(PORTAAL_LEVELS), { ...standaard, structuralGrid: false });
    ok(peilmaatEls().every(zichtbaar), "eerst zichtbaar");
    zetZicht({ ...standaard, structuralGrid: false, levelMarks: false });
    await wacht();
    gelijk(tekenvlakEl().dataset.openFem3dBuildMode, "level-marks-visibility", "geen volledige opbouw");
    ok(peilmaatEls().length === PORTAAL_LEVELS.length && peilmaatEls().every((el) => !zichtbaar(el)), "labels verborgen");
    zetZicht({ ...standaard, structuralGrid: false, levelMarks: true });
    await wacht();
    gelijk(tekenvlakEl().dataset.openFem3dBuildMode, "level-marks-visibility", "weer aan: ook het snelle pad");
    ok(peilmaatEls().every(zichtbaar), "weer zichtbaar");
    controleerPlaats(portaal, "na weer aanzetten");
  });

  await test("peilmaten uit bij het openen, stramien aan: geen peilmaten en geen kale levelnaam", async () => {
    await toon(portaal, stramien(PORTAAL_LEVELS), { ...standaard, levelMarks: false });
    gelijk(peilmaatEls().length, 0, "geen peilmaten");
    gelijk(container.querySelectorAll(".open-fem3d-level-label").length, 0, "geen kale levellabels");
  });

  for (const [naam, model, levels] of [["portaal 6 × 4 × 7", portaal, PORTAAL_LEVELS], ["hal 30 × 12 × 6", hal, HAL_LEVELS]] as const) {
    for (const view of ["iso", "front", "side"] as const) {
      for (const [stand, zicht] of [["perspectief", standaard], ["parallel", parallel(standaard)]] as const) {
        await test(`${naam}, ${view}, ${stand}: aan de linker hoek, punt op het streepje, niet over staven, in beeld`, async () => {
          await toon(model, stramien(levels), zicht, view);
          gelijk(tekenvlakEl().dataset.openFem3dProjection, stand === "perspectief" ? "perspective" : "orthographic", "projectie");
          gelijk(peilmaatEls().length, levels.length, "één peilmaat per level");
          controleerPlaats(model, `${naam} ${view} ${stand}`);
        });
      }
    }
  }

  await test("gedraaid naar achter (camera op +y): de peilmaat hangt aan de hoek (xMax, yMax)", async () => {
    await toon(portaal, stramien(PORTAAL_LEVELS), { ...standaard, structuralGrid: false });
    zetCamera({ position: [3, 40, 3.5], target: [3, 2, 3.5], up: [0, 0, 1] });
    await wacht(120);
    const cam = camera();
    for (const el of peilmaatEls()) {
      const [, xMax, , yMax] = el.dataset.openFem3dLevelMarkRand!.split(",").map(Number);
      gelijk(verwachteHoek(cam, el).slice(0, 2), [xMax, yMax], `${el.dataset.openFem3dLevelMark}: linker hoek vanaf achter`);
    }
    controleerPlaats(portaal, "achter");
  });

  await test("het label is niet breder dan de schatting waarmee passend beeld ruimte maakt", async () => {
    await toon(portaal, stramien(PORTAAL_LEVELS), { ...standaard, structuralGrid: false });
    for (const el of peilmaatEls()) {
      const breedte = el.getBoundingClientRect().width;
      const schatting = openFem3DPeilmaatBreedtePx(el.querySelector(".open-fem3d-level-mark-tekst")!.textContent!);
      ok(breedte <= schatting + 1, `${el.dataset.openFem3dLevelMark}: ${breedte.toFixed(1)} px > schatting ${schatting.toFixed(1)} px`);
      ok(breedte >= schatting * 0.75, `${el.dataset.openFem3dLevelMark}: ${breedte.toFixed(1)} px, schatting ${schatting.toFixed(1)} px veel te ruim`);
    }
  });
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });
