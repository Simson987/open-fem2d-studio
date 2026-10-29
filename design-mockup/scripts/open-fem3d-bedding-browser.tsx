/**
 * Browserkant van test-open-fem3d-bedding-ui.mjs: staaf op bedding in 3D
 * (issue #106) in de echte onderdelen, in een lokale headless browser.
 *
 *  - Eigenschappen van een staaf: het vinkje "Op bedding" met k = 50 000
 *    kN/m³ en b leeg (zoals de 2D-staafdialoog); pas met b wordt de bedding
 *    gezet. Alleen druk, zijdelingse k en uitvinken. Een paal krijgt alleen
 *    de zijdelingse k. Een meervoudige selectie (half vinkje) zet alle staven
 *    in één keer. Een trek-alleen staaf weigert met een melding. De tab
 *    Resultaten toont zakking, gronddruk en het deel zonder contact. Een
 *    coördinaat of eindknoop die een staaf op een verticale k verticaal zet,
 *    wordt met een melding geweigerd; staat er op een verticale staaf toch
 *    een verticale k, dan blijft het k-veld zichtbaar om haar te wissen.
 *  - Het tekenvlak: de gearceerde band onder de staaf en aan twee zijden van
 *    de paal (met de laag Opleggingen; uit = weg), de stippellijn van alleen
 *    druk, de band twee keer zo groot bij Opleggingen 200 % (de conditielaag
 *    bouwt opnieuw op), en een klik op de band kiest de staaf.
 *  - De resultaatlaag Gronddruk: de lijn, de waarden en "geen contact"; in
 *    de verkenner de schakelaar met het blok Waarden eronder.
 *  - Het rapport: de tabel Staven op bedding.
 *
 * `#beeld=…` toont alleen een beeld voor een schermafbeelding: eigenschappen,
 * band of gronddruk.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as THREE from "three";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/openaec/openaec-tokens.css";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import "../src/components/fem/FemProjectTree.css";
import OpenFem3DProperties from "../src/components/openFem3d/OpenFem3DProperties";
import OpenFem3DExplorer from "../src/components/openFem3d/OpenFem3DExplorer";
import OpenFem3DReport from "../src/components/openFem3d/OpenFem3DReport";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import { OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel, type OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSelection } from "../src/components/openFem3d/openFem3dSelection";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DUtilization } from "../src/components/openFem3d/openFem3dUtilization";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_STRUCTURAL_GRID } from "../src/components/fem/femTypes";

// Synthetische PointerEvents hebben geen actieve aanwijzer om vast te houden.
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

// De renderer, scène en camera waarmee het tekenvlak echt tekent (zoals in
// open-fem3d-symboolschaal-browser.tsx).
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
function typ(el: HTMLInputElement, waarde: string) {
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, waarde);
  flushSync(() => el.dispatchEvent(new Event("input", { bubbles: true })));
  flushSync(() => el.blur());
}
const veld = (selector: string) => container.querySelector<HTMLInputElement>(selector);

/* ── Model: een portaal op een funderingsbalk, met een paal ─────────────── */

const strook = { kKnPerM3: 50_000, widthM: 0.6, compressionOnly: true };
const portaal = (bedding = true): OpenFem3DModel => parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }, { id: 3, x: 0, y: 0, z: 3 }, { id: 4, x: 6, y: 0, z: 3 },
    { id: 5, x: 0, y: 0, z: -5 }, { id: 6, x: 6, y: 4, z: 3 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEB 300", material: "S235", ...(bedding ? { bedding: strook } : {}) },
    { id: 2, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235" },
    { id: 3, startNodeId: 2, endNodeId: 4, profileName: "HEA 200", material: "S235" },
    { id: 4, startNodeId: 3, endNodeId: 4, profileName: "IPE 300", material: "S235" },
    { id: 5, startNodeId: 5, endNodeId: 1, profileName: "HEB 300", material: "S235",
      ...(bedding ? { bedding: { widthM: 0.3, kLateralKnPerM3: 20_000 } } : {}) },
    { id: 6, startNodeId: 4, endNodeId: 6, profileName: "RD 24", material: "S235", tensionOnly: true },
  ],
  supports: [{ nodeId: 5, ...OPEN_FEM_3D_SUPPORT_PRESETS.pinned }],
  loads: [{ id: 1, nodeId: 4, fx: 5, fy: 0, fz: -40, mx: 0, my: 0, mz: 0 }],
});

/** Een kleine uitkomst van de kern met bedding: staaf 1 komt aan het eind los, de paal zijdelings. */
function uitkomst(model: OpenFem3DModel): OpenFem3DSolveResult {
  const punten = (lijst: [number, number, boolean][]) => lijst.map(([t, w, active]) => ({
    t, settlementM: w, pressureKnPerM: active ? 30_000 * w : 0, active,
  }));
  return {
    schemaVersion: 1,
    engine: { id: "open-fem-3d", name: "Open FEM 3D", revision: "test", license: "AGPL-3.0" },
    analysis: "linear",
    displacements: model.nodes.map((node) => ({
      nodeId: node.id, ux: 0, uy: 0, uz: node.id === 1 ? -0.004 : node.id === 2 ? 0.001 : 0, rx: 0, ry: 0, rz: 0,
    })),
    reactions: [],
    memberForces: model.beams.map((beam) => ({
      memberId: beam.id, lengthM: 1, nStartKn: 0, nEndKn: 0, vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
      torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
    })),
    diagrams: { momentY: [], momentZ: [], shearY: [], shearZ: [], axial: [], torsion: [] },
    buckling: { status: "notApplicable", reason: "test" },
    diagnostics: [],
    bedding: [
      {
        memberId: 1,
        points: punten([[0, 0.004, true], [0.125, 0.0034, true], [0.25, 0.0028, true], [0.375, 0.0021, true], [0.5, 0.0014, true],
          [0.625, 0.0007, true], [0.75, -0.0001, false], [0.875, -0.0005, false], [1, -0.001, false]]),
        maxPressureKnPerM: 120, minPressureKnPerM: 0, maxSettlementM: 0.004, totalReactionKn: 45, liftedFraction: 0.3125,
      },
      {
        memberId: 5,
        points: [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, settlementM: 0, pressureKnPerM: 0, lateralKnPerM: 4 * t, active: true })),
        maxPressureKnPerM: 0, minPressureKnPerM: 0, maxSettlementM: 0, totalReactionKn: 0, liftedFraction: 0,
      },
    ],
  };
}

/* ── Eigenschappen in een omhulsel dat het model bijhoudt ────────────── */

let wijzigingen: OpenFem3DModel[] = [];
function Paneel({ begin, selectie, result = null }: { begin: OpenFem3DModel; selectie: OpenFem3DSelection; result?: OpenFem3DSolveResult | null }) {
  const [model, setModel] = useState(begin);
  return <div style={{ width: 320, background: "var(--theme-bg, #fff)" }} className="open-fem3d-editor">
    <OpenFem3DProperties model={model} selection={selectie} result={result}
      onChange={(next) => { wijzigingen.push(next); setModel(next); }} />
  </div>;
}
const laatste = () => wijzigingen[wijzigingen.length - 1];
const staaf = (model: OpenFem3DModel | undefined, id: number) => model?.beams.find((beam) => beam.id === id);

/* ── Het tekenvlak ───────────────────────────────────────────────────── */

const GEEN_BENUTTINGEN: OpenFem3DUtilization[] = [];
let zetZicht: (zicht: OpenFem3DVisibility) => void = () => {};
let gekozen: OpenFem3DSelection = null;
function Tekenvlak({ model, zicht: beginZicht, camera, result = null }: {
  model: OpenFem3DModel; zicht: OpenFem3DVisibility; camera?: OpenFem3DCameraState; result?: OpenFem3DSolveResult | null;
}) {
  const [zicht, setZicht] = useState(beginZicht);
  const [sel, setSel] = useState<OpenFem3DSelection>(null);
  zetZicht = (next) => flushSync(() => setZicht(next));
  return <div className="open-fem3d-stage" style={{ width: 1000, height: 700, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={sel}
      onSelect={(next) => { gekozen = next; setSel(next); }}
      fitToken={0} visibility={zicht} utilizations={GEEN_BENUTTINGEN} result={result}
      cameraRequest={camera ? { state: camera, token: 1 } : undefined} viewRequest={camera ? undefined : { kind: "iso", token: 1 }} />
  </div>;
}
/** Parallel, recht van voren (camera op −y): de band onder de balk en de paal in beeld. */
const VOOR: OpenFem3DCameraState = { position: [3, -40, -0.5], target: [3, 0, -0.5], up: [0, 0, 1], orthoHalfHeight: 5 };
const basisZicht: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, perspective: false, grid: false, axes: false, structuralGrid: false, levelMarks: false,
  nodeNumbers: false, viewCube: false, loads: false,
};
async function toon(model: OpenFem3DModel, zicht: OpenFem3DVisibility, camera?: OpenFem3DCameraState, result?: OpenFem3DSolveResult | null) {
  gekozen = null;
  mount(<Tekenvlak model={model} zicht={zicht} camera={camera} result={result} />);
  await wacht(250);
}
const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;
const canvasEl = () => container.querySelector("canvas") as HTMLCanvasElement;
function banden(): THREE.Mesh[] {
  const uit: THREE.Mesh[] = [];
  renderScene?.traverse((o) => { if (o.userData.openFem3dBeddingBand && (o as THREE.Mesh).isMesh) uit.push(o as THREE.Mesh); });
  return uit;
}
const bandVan = (beamId: number) => banden().find((mesh) => mesh.userData.id === beamId);
function klikWereld(p: THREE.Vector3) {
  ok(renderCamera, "er is getekend");
  const n = p.clone().project(renderCamera!);
  const rect = canvasEl().getBoundingClientRect();
  const clientX = rect.left + (n.x + 1) / 2 * rect.width;
  const clientY = rect.top + (1 - n.y) / 2 * rect.height;
  for (const [type, knoppen] of [["pointerdown", 1], ["pointerup", 0]] as const) {
    flushSync(() => canvasEl().dispatchEvent(new PointerEvent(type, {
      clientX, clientY, button: 0, buttons: knoppen, pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true,
    })));
  }
}

/* ── Proeven ──────────────────────────────────────────────────────────── */

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("eigenschappen: Op bedding aanvinken, k standaard 50 000 en b leeg; pas met b wordt de bedding gezet", async () => {
    wijzigingen = [];
    mount(<Paneel begin={portaal(false)} selectie={{ type: "beam", id: 1 }} />);
    await wacht();
    const vinkje = veld("[data-open-fem3d-bedding]");
    ok(vinkje && !vinkje.checked, "het vinkje staat in het paneel, uit");
    ok(container.textContent?.includes("Staaf op bedding") && container.textContent.includes("Op bedding"), "kop en label");
    flushSync(() => vinkje!.click());
    await wacht();
    gelijk(wijzigingen.length, 0, "zonder b nog geen wijziging");
    ok(container.querySelector("[data-open-fem3d-bedding-incomplete]"), "de melding dat k én b nodig zijn");
    gelijk(veld("[data-open-fem3d-bedding-k]")?.value, "50000", "k staat op 50 000");
    gelijk(veld("[data-open-fem3d-bedding-width]")?.value, "", "b is leeg");
    ok(veld("[data-open-fem3d-bedding-width]")?.placeholder.includes("300"), "voorbeeld bij b");
    typ(veld("[data-open-fem3d-bedding-width]")!, "600");
    await wacht();
    gelijk(staaf(laatste(), 1)?.bedding, { kKnPerM3: 50_000, widthM: 0.6 }, "b = 600 mm zet de bedding (in m)");
    gelijk(wijzigingen.length, 1, "één wijziging, één stap ongedaan maken");
    ok(!container.querySelector("[data-open-fem3d-bedding-incomplete]"), "de melding is weg");
  });

  await test("eigenschappen: alleen druk, zijdelingse k en uitvinken", async () => {
    wijzigingen = [];
    mount(<Paneel begin={parseOpenFem3DModel({ ...portaal(false), beams: portaal(false).beams.map((b) => b.id === 1 ? { ...b, bedding: { kKnPerM3: 50_000, widthM: 0.6 } } : b) })}
      selectie={{ type: "beam", id: 1 }} />);
    await wacht();
    ok(veld("[data-open-fem3d-bedding]")?.checked, "aan");
    gelijk(veld("[data-open-fem3d-bedding-width]")?.value, "600", "b in mm");
    flushSync(() => veld("[data-open-fem3d-bedding-compression]")!.click());
    await wacht();
    gelijk(staaf(laatste(), 1)?.bedding, { kKnPerM3: 50_000, widthM: 0.6, compressionOnly: true }, "alleen druk aan");
    typ(veld("[data-open-fem3d-bedding-lateral]")!, "20000");
    await wacht();
    gelijk(staaf(laatste(), 1)?.bedding, { kKnPerM3: 50_000, widthM: 0.6, kLateralKnPerM3: 20_000, compressionOnly: true }, "zijdelingse k");
    typ(veld("[data-open-fem3d-bedding-k]")!, "-5");
    await wacht();
    gelijk(veld("[data-open-fem3d-bedding-k]")?.value, "50000", "een negatieve k zet de vorige waarde terug");
    gelijk(wijzigingen.length, 2, "en verandert niets");
    flushSync(() => veld("[data-open-fem3d-bedding]")!.click());
    await wacht();
    ok(!("bedding" in staaf(laatste(), 1)!), "uitvinken haalt de bedding weg");
  });

  await test("eigenschappen: een paal krijgt alleen de zijdelingse k", async () => {
    wijzigingen = [];
    mount(<Paneel begin={portaal(false)} selectie={{ type: "beam", id: 5 }} />);
    await wacht();
    flushSync(() => veld("[data-open-fem3d-bedding]")!.click());
    await wacht();
    ok(!veld("[data-open-fem3d-bedding-k]") && !veld("[data-open-fem3d-bedding-compression]"), "geen verticale k en geen alleen druk");
    ok(container.querySelector("[data-open-fem3d-bedding-vertical]"), "de uitleg bij een paal");
    gelijk(veld("[data-open-fem3d-bedding-lateral]")?.value, "50000", "zijdelingse k op 50 000");
    typ(veld("[data-open-fem3d-bedding-width]")!, "300");
    await wacht();
    gelijk(staaf(laatste(), 5)?.bedding, { widthM: 0.3, kLateralKnPerM3: 50_000 }, "de paal staat zijdelings op bedding");
  });

  // Review #106: een geometriewijziging die een staaf op een verticale k (bijna) verticaal zet,
  // wordt in het paneel geweigerd met een melding; daarna blijft het model geldig.
  await test("eigenschappen: een coördinaat die de staaf op bedding verticaal zet, wordt geweigerd met een melding", async () => {
    wijzigingen = [];
    mount(<Paneel begin={portaal(true)} selectie={{ type: "node", id: 2 }} />);
    await wacht();
    const coordinaat = () => [...container.querySelectorAll<HTMLInputElement>("input.fem-prop-input")].slice(0, 3);
    typ(coordinaat()[2], "6000");
    await wacht();
    gelijk(wijzigingen.length, 1, "z = 6000 mm (staaf onder 45°) mag");
    typ(coordinaat()[0], "0");
    await wacht();
    gelijk(wijzigingen.length, 1, "x = 0 (staaf 1 verticaal) verandert niets");
    const melding = container.querySelector("[data-open-fem3d-geometry-error]");
    ok(melding?.textContent?.includes("Staaf 1 komt dan (bijna) verticaal"), `de melding noemt staaf 1: ${melding?.textContent}`);
    gelijk(coordinaat()[0].value, "6000", "het X-veld toont weer de opgeslagen waarde");
    parseOpenFem3DModel(laatste());
  });

  await test("eigenschappen: omhangen naar een knoop recht erboven wordt geweigerd met een melding", async () => {
    wijzigingen = [];
    mount(<Paneel begin={portaal(true)} selectie={{ type: "beam", id: 1 }} />);
    await wacht();
    const eind = container.querySelectorAll<HTMLSelectElement>("select.fem-prop-input")[1];
    ok(eind && eind.value === "2", "de keuzelijst van de eindknoop");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(eind, "3");
    flushSync(() => eind.dispatchEvent(new Event("change", { bubbles: true })));
    await wacht();
    gelijk(wijzigingen.length, 0, "geen wijziging");
    ok(container.querySelector("[data-open-fem3d-geometry-error]")?.textContent?.includes("Staaf 1 komt dan (bijna) verticaal"), "de melding");
  });

  await test("eigenschappen: een verticale staaf met nog een verticale k toont k, zodat die te wissen is", async () => {
    wijzigingen = [];
    // Buiten de keuring om, zoals een model van vóór deze controle: knoop 2 recht boven knoop 1.
    const begin = portaal(true);
    const ongeldig = { ...begin, nodes: begin.nodes.map((n) => n.id === 2 ? { ...n, x: 0, z: 6 } : n) };
    mount(<Paneel begin={ongeldig} selectie={{ type: "beam", id: 1 }} />);
    await wacht();
    ok(veld("[data-open-fem3d-bedding-k]"), "het k-veld staat er");
    ok(container.querySelector("[data-open-fem3d-bedding-vertical-k]"), "met de melding dat k hier niet kan");
    typ(veld("[data-open-fem3d-bedding-k]")!, "");
    await wacht();
    gelijk(wijzigingen.length, 0, "k gewist: nog geen constante, dus nog niets gezet");
    typ(veld("[data-open-fem3d-bedding-lateral]")!, "20000");
    await wacht();
    gelijk(staaf(laatste(), 1)?.bedding, { widthM: 0.6, kLateralKnPerM3: 20_000 }, "met de zijdelingse k is de bedding weer geldig");
    ok(!veld("[data-open-fem3d-bedding-k]"), "daarna geen k-veld meer");
  });

  await test("eigenschappen: meervoudige selectie, half vinkje en alles in één keer", async () => {
    wijzigingen = [];
    const begin = parseOpenFem3DModel({ ...portaal(false), beams: portaal(false).beams.map((b) => b.id === 1 ? { ...b, bedding: strook } : b) });
    mount(<Paneel begin={begin} selectie={{ type: "multi", nodeIds: [], beamIds: [1, 4] }} />);
    await wacht();
    const vinkje = veld("[data-open-fem3d-bedding]")!;
    ok(vinkje.indeterminate, "één van twee staven op bedding: half vinkje");
    ok(container.textContent?.includes("Op bedding (2 staven)"), "het label noemt het aantal");
    flushSync(() => vinkje.click());
    await wacht();
    gelijk(wijzigingen.length, 1, "één wijziging");
    gelijk([1, 4].map((id) => staaf(laatste(), id)?.bedding), [strook, strook], "beide staven dezelfde bedding");
  });

  await test("eigenschappen: een trek-alleen staaf weigert de bedding met een melding", async () => {
    wijzigingen = [];
    mount(<Paneel begin={portaal(false)} selectie={{ type: "beam", id: 6 }} />);
    await wacht();
    flushSync(() => veld("[data-open-fem3d-bedding]")!.click());
    await wacht();
    typ(veld("[data-open-fem3d-bedding-width]")!, "200");
    await wacht();
    gelijk(wijzigingen.length, 0, "geen wijziging");
    ok(container.querySelector("[data-open-fem3d-bedding-error]")?.textContent?.includes("trek-alleen"), "de melding noemt trek-alleen");
  });

  await test("eigenschappen: de tab Resultaten toont zakking, gronddruk en het deel zonder contact", async () => {
    const model = portaal();
    mount(<Paneel begin={model} selectie={{ type: "beam", id: 1 }} result={uitkomst(model)} />);
    await wacht();
    const tab = [...container.querySelectorAll<HTMLButtonElement>(".fem-prop-tab")].find((knop) => knop.textContent === "Resultaten");
    flushSync(() => tab!.click());
    await wacht();
    const blok = container.querySelector("[data-open-fem3d-bedding-results='1']");
    ok(blok, "het blok Bedding");
    const tekst = blok!.textContent ?? "";
    ok(tekst.includes("4.000 mm") && tekst.includes("120.00 kN/m") && tekst.includes("200.00 kN/m²") && tekst.includes("31.3 %"),
      `zakking, gronddruk (kN/m en kN/m²) en zonder contact: ${tekst}`);
  });

  await test("tekenvlak: de band onder de balk en aan twee zijden van de paal, met de laag Opleggingen", async () => {
    await toon(portaal(), basisZicht, VOOR);
    ok(bandVan(1) && bandVan(5), `een band bij staaf 1 en de paal (${banden().map((m) => m.userData.id).join(",")})`);
    gelijk(banden().length, 2, "alleen staven op bedding");
    const balk = new THREE.Box3().setFromObject(bandVan(1)!);
    ok(balk.max.z < 0 && balk.min.x >= -1e-6 && balk.max.x <= 6 + 1e-6, `de band ligt onder de balk (z ${balk.min.z.toFixed(2)} … ${balk.max.z.toFixed(2)})`);
    const paal = new THREE.Box3().setFromObject(bandVan(5)!);
    ok(paal.min.x < -0.01 && paal.max.x > 0.01, `de paal: arcering aan beide zijden (x ${paal.min.x.toFixed(2)} … ${paal.max.x.toFixed(2)})`);
    gelijk((bandVan(5)!.geometry.getAttribute("position") as THREE.BufferAttribute).count, 12, "twee vlakken bij de paal");
    let gestippeld = 0;
    renderScene!.traverse((o) => { if (o.userData.openFem3dBeddingContact === "compressionOnly") gestippeld += 1; });
    gelijk(gestippeld, 1, "alleen druk: de contactlijn van de balk gestippeld");
    zetZicht({ ...basisZicht, supports: false });
    await wacht(80);
    gelijk(banden().length, 0, "Opleggingen uit: geen band");
  });

  await test("tekenvlak: de band volgt de regelaar Opleggingen (200 % = twee keer zo diep)", async () => {
    await toon(portaal(), basisZicht, VOOR);
    const diepte = () => { const box = new THREE.Box3().setFromObject(bandVan(1)!); return -box.min.z; };
    const bij100 = diepte();
    zetZicht({ ...basisZicht, supportSizePercent: 200 });
    await wacht(80);
    const bij200 = diepte();
    ok(Math.abs(bij200 / bij100 - 2) < 1e-6, `diepte ${bij100.toFixed(3)} → ${bij200.toFixed(3)} m`);
    gelijk(tekenvlakEl().dataset.openFem3dBuildMode, "support-scale-conditions", "met banden bouwt de conditielaag opnieuw op");
  });

  await test("tekenvlak: een klik op de band kiest de staaf", async () => {
    await toon(portaal(), basisZicht, VOOR);
    const box = new THREE.Box3().setFromObject(bandVan(1)!);
    klikWereld(new THREE.Vector3(4.5, 0, (box.min.z + box.max.z) / 2));
    await wacht(80);
    gelijk(gekozen, { type: "beam", id: 1 }, "staaf 1 gekozen");
  });

  await test("resultaten: de laag Gronddruk tekent de lijn, de waarden en waar de grond loslaat", async () => {
    const model = portaal();
    await toon(model, { ...basisZicht, deformation: false, reactions: false, utilization: false, groundPressure: true }, VOOR, uitkomst(model));
    gelijk(tekenvlakEl().dataset.openFem3dResultDiagrams, "1", "één gronddruklijn (de paal heeft geen verticale gronddruk)");
    gelijk(tekenvlakEl().dataset.openFem3dBeddingLifted, "1", "één stuk zonder contact");
    const labels = [...container.querySelectorAll(".open-fem3d-diagram-p")].map((el) => el.textContent);
    ok(labels.some((tekst) => tekst?.startsWith("p +120.0 kN/m")), `de grootste gronddruk als waarde: ${labels.join(" | ")}`);
    ok(container.querySelector(".open-fem3d-bedding-lifted-label")?.textContent === "geen contact", "\"geen contact\" bij het losse stuk");
    let lijn: THREE.Object3D | null = null;
    renderScene!.traverse((o) => { if (o.userData.openFem3dBeddingLifted) lijn = o; });
    ok(lijn, "de grijze stippellijn");
    zetZicht({ ...basisZicht, deformation: false, reactions: false, utilization: false, groundPressure: false });
    await wacht(80);
    gelijk(tekenvlakEl().dataset.openFem3dResultDiagrams, "0", "laag uit: geen lijn");
  });

  await test("verkenner: de schakelaar Gronddruk, met Waarden eronder als het de eerste lijn is", async () => {
    const model = portaal();
    let zicht: OpenFem3DVisibility = { ...DEFAULT_OPEN_FEM_3D_VISIBILITY };
    const Verkenner = () => {
      const [v, setV] = useState(zicht);
      return <OpenFem3DExplorer model={model} selection={null} setSelection={() => {}} result={uitkomst(model)}
        visibility={v} setVisibility={(next) => { zicht = next; setV(next); }} activeTab="results"
        displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} gridShow={false} setGridShow={() => {}}
        structuralGrid={DEFAULT_STRUCTURAL_GRID} setStructuralGridEnabled={() => {}} setDiagramLabels={() => {}} />;
    };
    mount(<Verkenner />);
    await wacht();
    const rij = container.querySelector("[data-open-fem3d-result-layer='groundPressure']");
    ok(rij?.textContent?.includes("Gronddruk"), "de rij Gronddruk");
    flushSync(() => rij!.querySelector<HTMLButtonElement>("button")!.click());
    await wacht();
    ok(zicht.groundPressure, "aangezet");
    ok(container.querySelector("[data-open-fem3d-result-layer='groundPressure'] [data-open-fem3d-diagram-label-controls]"),
      "het blok Waarden staat onder Gronddruk");
  });

  await test("rapport: de tabel Staven op bedding", async () => {
    const model = portaal();
    mount(<OpenFem3DReport model={model} result={uitkomst(model)} />);
    await wacht();
    const sectie = container.querySelector("[data-open-fem3d-report-bedding]");
    ok(sectie?.textContent?.includes("Staven op bedding"), "de kop");
    const rij = sectie!.querySelector("[data-open-fem3d-report-bedding-row='1']")!.textContent ?? "";
    ok(rij.includes("50.000") && rij.includes("600") && rij.includes("ja") && rij.includes("4") && rij.includes("200") && rij.includes("31,3 %"),
      `k, b, alleen druk, w, p/b en zonder contact: ${rij}`);
    ok(sectie!.querySelector("[data-open-fem3d-report-bedding-row='5']"), "de paal staat erin");
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  const model = portaal();
  if (beeld === "eigenschappen") {
    mount(<div style={{ padding: 8, background: "#fff", width: 340 }}>
      <Paneel begin={model} selectie={{ type: "beam", id: 1 }} />
    </div>);
    await wacht(200);
    return;
  }
  if (beeld === "band") {
    await toon(model, { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, grid: false, structuralGrid: false, levelMarks: false, nodeNumbers: false },
      { position: [11, -10, 5], target: [3, 0, -1.2], up: [0, 0, 1] });
    await wacht(300);
    return;
  }
  if (beeld === "gronddruk") {
    await toon(model, { ...basisZicht, deformation: false, reactions: false, utilization: false, groundPressure: true, viewCube: false }, VOOR, uitkomst(model));
    await wacht(300);
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });
