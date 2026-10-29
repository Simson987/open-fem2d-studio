/**
 * Browserkant van test-open-fem3d-plaatbedding-e2e.mjs: de echte uitkomst van
 * de 3D-kern voor een vloer op zand (issue #107) in het echte tekenvlak,
 * de verkenner en het rapport, in een lokale headless browser. De testkant
 * rekent het model door de app en de kern en zet model en uitkomst in
 * `window.__PLAATBEDDING_E2E__`; hier wordt niets gerekend.
 *
 *  - De contour Gronddruk over de vloer, de stippen op de
 *    knopen zonder contact (zoveel als de kern er losliet), en de arcering.
 *  - De keuzelijst in de verkenner met Gronddruk en Zakking.
 *  - Het rapport: de tabel Platen op bedding met de getallen van de kern.
 *
 * `#beeld=…` toont alleen een beeld voor een schermafbeelding: gronddruk,
 * zakking of rapport.
 *
 * Ook voor de begane-grondvloer van test-open-fem3d-plaatbedding-vloer.mjs:
 * die geeft een eigen camera en de beddingsconstante zoals het rapport haar
 * schrijft mee (`camera`, `verwacht.kTekst`).
 */
import React from "react";
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
import OpenFem3DReport from "../src/components/openFem3d/OpenFem3DReport";
import OpenFem3DExplorer from "../src/components/openFem3d/OpenFem3DExplorer";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import type { OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import type { OpenFem3DPlateQuantity } from "../src/components/openFem3d/openFem3dPlateResults";
import { openFem3DPlateQuantityRange } from "../src/components/openFem3d/openFem3dPlateResults";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DUtilization } from "../src/components/openFem3d/openFem3dUtilization";
import { DEFAULT_DISPLAY_FLAGS } from "../src/components/fem/FemResultsOverlay";
import { DEFAULT_STRUCTURAL_GRID } from "../src/components/fem/femTypes";

interface Gegevens {
  model: OpenFem3DModel;
  result: OpenFem3DSolveResult & { plateMesh: { beamIntermediateNodes: unknown; plateEdgeNodes: unknown } };
  verwacht: { pMax: number; los: number; sMaxMm: number; sigmaR: number; kTekst?: string };
  /** Camera voor het tekenvlak; zonder: schuin op de vloer van 8 × 6 m. */
  camera?: OpenFem3DCameraState;
}
const ruw = (window as unknown as { __PLAATBEDDING_E2E__: Gegevens }).__PLAATBEDDING_E2E__;
// Het rekennet heeft Maps; die gingen als lijsten van paren mee.
const net = ruw.result.plateMesh as unknown as Record<string, unknown>;
const result = {
  ...ruw.result,
  plateMesh: {
    ...net,
    beamIntermediateNodes: new Map(net.beamIntermediateNodes as [number, number[]][]),
    plateEdgeNodes: new Map(net.plateEdgeNodes as [number, number[][]][]),
  },
} as unknown as OpenFem3DSolveResult;
const model = ruw.model;

// De scène waarmee het tekenvlak echt tekent (zoals open-fem3d-plaatbedding-browser.tsx).
let renderScene: THREE.Object3D | null = null;
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  set(this: THREE.WebGLRenderer, fn: (scene: THREE.Object3D, camera: THREE.Camera) => void) {
    Object.defineProperty(this, "render", {
      configurable: true, writable: true,
      value: (scene: THREE.Object3D, cam: THREE.Camera) => { renderScene = scene; return fn.call(this, scene, cam); },
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
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); } catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}

const GEEN_BENUTTINGEN: OpenFem3DUtilization[] = [];
function Tekenvlak({ zicht, camera, quantity }: { zicht: OpenFem3DVisibility; camera: OpenFem3DCameraState; quantity: OpenFem3DPlateQuantity }) {
  return <div className="open-fem3d-stage" style={{ width: 1200, height: 700, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={null} onSelect={() => {}}
      fitToken={0} visibility={zicht} utilizations={GEEN_BENUTTINGEN} result={result} plateQuantity={quantity}
      cameraRequest={{ state: camera, token: 1 }} />
  </div>;
}
const ISO: OpenFem3DCameraState = ruw.camera ?? { position: [13.5, -7.5, 7], target: [4, 2.6, 0], up: [0, 0, 1] };
const zicht: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, grid: false, structuralGrid: false, levelMarks: false, nodeNumbers: false,
  loads: false, deformation: false, reactions: false, utilization: false,
};
const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }

  await test("tekenvlak: de contour Gronddruk van de kern over de vloer, met de stippen zonder contact en de arcering", async () => {
    mount(<Tekenvlak zicht={zicht} camera={ISO} quantity="groundPressure" />);
    await wacht(300);
    ok(tekenvlakEl().dataset.openFem3dPlateOverlay === "contour:groundPressure", `contour: ${tekenvlakEl().dataset.openFem3dPlateOverlay}`);
    const platen = new Set<number>();
    renderScene!.traverse((o) => { if (o.userData.openFem3dPlateContour !== undefined) platen.add(o.userData.openFem3dPlateContour); });
    ok([...platen].join() === "1", `alleen de vloer: ${[...platen].join()}`);
    ok(tekenvlakEl().dataset.openFem3dPlateLifted === String(ruw.verwacht.los),
      `stippen: ${tekenvlakEl().dataset.openFem3dPlateLifted}, de kern liet ${ruw.verwacht.los} knopen los`);
    ok(tekenvlakEl().dataset.openFem3dPlateBedding === "1", "de arcering onder de vloer");
    const bereik = openFem3DPlateQuantityRange(result, "groundPressure");
    ok(bereik && Math.abs(bereik.max - ruw.verwacht.pMax) < 1e-9, `het bereik van de legenda eindigt op de grootste gronddruk van de kern (${bereik?.max})`);
  });

  await test("verkenner: Gronddruk en Zakking in de keuzelijst bij deze uitkomst", async () => {
    mount(<OpenFem3DExplorer model={model} selection={null} setSelection={() => {}} result={result}
      visibility={DEFAULT_OPEN_FEM_3D_VISIBILITY} setVisibility={() => {}} activeTab="results"
      displayFlags={DEFAULT_DISPLAY_FLAGS} setDisplayFlags={() => {}} gridShow={false} setGridShow={() => {}}
      structuralGrid={DEFAULT_STRUCTURAL_GRID} setStructuralGridEnabled={() => {}} setDiagramLabels={() => {}}
      plateQuantity="groundPressure" setPlateQuantity={() => {}} />);
    await wacht();
    const keuze = container.querySelector<HTMLSelectElement>("[data-open-fem3d-plate-quantity] select");
    const waarden = [...(keuze?.options ?? [])].map((optie) => optie.value);
    ok(waarden.includes("groundPressure") && waarden.includes("settlement") && keuze?.value === "groundPressure", waarden.join(","));
  });

  await test("rapport: de tabel Platen op bedding met de getallen van de kern", async () => {
    mount(<OpenFem3DReport model={model} result={result} />);
    await wacht();
    const rij = container.querySelector("[data-open-fem3d-report-plate-bedding-row='1']")?.textContent ?? "";
    // Zoals het rapport getallen schrijft (OpenFem3DReport: hoogstens zoveel decimalen).
    const nl = (x: number, cijfers: number) => x.toLocaleString("nl-NL", { maximumFractionDigits: cijfers });
    ok(rij.includes(ruw.verwacht.kTekst ?? "20.000") && rij.includes("ja") && rij.includes(nl(ruw.verwacht.sMaxMm, 2)) && rij.includes(nl(ruw.verwacht.pMax, 1))
      && rij.includes(nl(ruw.verwacht.sigmaR, 2)), `k, alleen druk, s max, p max en ΣR: ${rij}`);
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  if (beeld === "gronddruk" || beeld === "zakking") {
    mount(<Tekenvlak zicht={zicht} camera={ISO} quantity={beeld === "gronddruk" ? "groundPressure" : "settlement"} />);
    await wacht(300);
    return;
  }
  if (beeld === "rapport") {
    mount(<div style={{ padding: 8, background: "#fff" }}><OpenFem3DReport model={model} result={result} /></div>);
    await wacht(200);
    // Alleen de kop, de tabel Platen op bedding en de plaatresultaten in beeld.
    container.querySelectorAll<HTMLElement>(".open-fem3d-report-page > section").forEach((sectie) => {
      if (!sectie.matches("[data-open-fem3d-report-plate-bedding], [data-open-fem3d-report-plates]")) sectie.style.display = "none";
    });
  }
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });
