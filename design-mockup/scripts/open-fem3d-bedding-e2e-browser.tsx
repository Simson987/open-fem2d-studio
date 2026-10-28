/**
 * Browserkant van test-open-fem3d-bedding-e2e.mjs: de echte uitkomst van de
 * 3D-kern voor de funderingsbalk op bedding (issue #106) in het echte
 * tekenvlak en rapport, in een lokale headless browser. De testkant rekent
 * het model door de app en de kern en zet model en uitkomst in
 * `window.__BEDDING_E2E__`; hier wordt niets gerekend.
 *
 *  - Laag Gronddruk: een lijn per staaf op bedding, met als grootste waarde de
 *    gronddruk van de kern.
 *  - Vervormde vorm (zonder profielen: een lijn per staaf): de hoogte van de
 *    lijn is de zakking van de kern maal de vergroting; het label u max.
 *  - Alleen druk: de stukken zonder contact aan beide vrije einden.
 *  - De band onder beide staven op bedding.
 *  - Het rapport: de tabel Staven op bedding met de getallen van de kern.
 *
 * `#beeld=…` toont alleen een beeld voor een schermafbeelding: gronddruk,
 * alleen-druk, band of rapport.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as THREE from "three";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../src/i18n/locales/nl/common.json";
import ribbon from "../src/i18n/locales/nl/ribbon.json";
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import OpenFem3DReport from "../src/components/openFem3d/OpenFem3DReport";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import type { OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import type { OpenFem3DUtilization } from "../src/components/openFem3d/openFem3dUtilization";
import { openFem3DBeddingResultOf, openFem3DBeddingSettlementAt, openFem3DBeddingSummary } from "../src/components/openFem3d/openFem3dBedding";

interface Gegevens {
  model: OpenFem3DModel;
  result: OpenFem3DSolveResult;
  losModel: OpenFem3DModel;
  los: OpenFem3DSolveResult;
  verwacht: { pMax: number; wMaxMm: number };
}
const gegevens = (window as unknown as { __BEDDING_E2E__: Gegevens }).__BEDDING_E2E__;

// De scène waarmee het tekenvlak echt tekent (zoals open-fem3d-bedding-browser.tsx).
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
function Tekenvlak({ model, zicht, camera, result }: {
  model: OpenFem3DModel; zicht: OpenFem3DVisibility; camera: OpenFem3DCameraState; result: OpenFem3DSolveResult | null;
}) {
  return <div className="open-fem3d-stage" style={{ width: 1200, height: 700, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={null} onSelect={() => {}}
      fitToken={0} visibility={zicht} utilizations={GEEN_BENUTTINGEN} result={result}
      cameraRequest={{ state: camera, token: 1 }} />
  </div>;
}
/** Parallel, van opzij (camera op +x, kijkend naar −x): de balk langs Y van links naar rechts, de kolom erboven. */
const OPZIJ: OpenFem3DCameraState = { position: [40, 4, 0.5], target: [0, 4, 0.5], up: [0, 0, 1], orthoHalfHeight: 3.6 };
const SCHUIN: OpenFem3DCameraState = { position: [5, -2.5, 3], target: [0, 4, 0.6], up: [0, 0, 1] };
const basisZicht: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, perspective: false, grid: false, axes: false, structuralGrid: false, levelMarks: false,
  nodeNumbers: false, viewCube: false, loads: false, reactions: false, utilization: false, deformation: false,
};
async function toon(model: OpenFem3DModel, zicht: OpenFem3DVisibility, camera: OpenFem3DCameraState, result: OpenFem3DSolveResult | null) {
  mount(<Tekenvlak model={model} zicht={zicht} camera={camera} result={result} />);
  await wacht(300);
}
const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;
/** Het getal uit een label als "p +30.69 kN/m" of "u max 1.290 mm". */
const getal = (tekst: string | null | undefined) => Number(/([+-]?\d+(?:\.\d+)?)/.exec((tekst ?? "").replace("−", "-"))?.[1]);
const nl = (waarde: number, cijfers: number) => waarde.toLocaleString("nl-NL", { maximumFractionDigits: cijfers });

async function run() {
  await i18next.use(initReactI18next).init({ lng: "nl", resources: { nl: { common, ribbon } }, defaultNS: "common", initImmediate: false });
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }
  const { model, result, losModel, los, verwacht } = gegevens;

  await test("tekenvlak: laag Gronddruk met de uitkomst van de kern, een lijn per staaf en de grootste gronddruk als waarde", async () => {
    await toon(model, { ...basisZicht, groundPressure: true }, OPZIJ, result);
    ok(tekenvlakEl().dataset.openFem3dResultDiagrams === "2", `twee gronddruklijnen (${tekenvlakEl().dataset.openFem3dResultDiagrams})`);
    const labels = [...container.querySelectorAll(".open-fem3d-diagram-p")].map((el) => el.textContent ?? "");
    const waarden = labels.map(getal).filter(Number.isFinite);
    ok(waarden.length > 0, `waarden bij de gronddruklijn: ${labels.join(" | ")}`);
    // Het label toont 2 decimalen bij 10 … 100 kN/m: afronding ≤ 0,005.
    ok(Math.abs(Math.max(...waarden) - verwacht.pMax) <= 0.0051, `grootste waarde ${Math.max(...waarden)} = p max van de kern ${verwacht.pMax.toFixed(4)} kN/m`);
    ok(tekenvlakEl().dataset.openFem3dBeddingLifted === "0", "overal contact: geen stuk zonder contact");
  });

  await test("tekenvlak: de vervormde vorm van de funderingsbalk is de zakking van de kern maal de vergroting", async () => {
    await toon(model, { ...basisZicht, deformation: true, profiles: false }, OPZIJ, result);
    const schaal = Number(tekenvlakEl().dataset.openFem3dDeformationScale);
    ok(Number.isFinite(schaal) && schaal > 0, `vergroting ${tekenvlakEl().dataset.openFem3dDeformationScale}`);
    let laag: THREE.Object3D | null = null;
    renderScene!.traverse((o) => { if (o.userData.openFem3dDeformedLayer) laag = o; });
    ok(laag, "de laag Vervormd");
    const lijnen = (laag as unknown as THREE.Group).children.filter((c): c is THREE.Line => c instanceof THREE.Line);
    ok(lijnen.length === 3, `een lijn per staaf (${lijnen.length})`);
    const lid = openFem3DBeddingResultOf(result, 1)!;
    const pos = lijnen[0].geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      const t = i / (pos.count - 1);
      const verwachtZ = -openFem3DBeddingSettlementAt(lid, t) * schaal;
      ok(Math.abs(pos.getZ(i) - verwachtZ) <= 1e-6 * Math.max(1, Math.abs(verwachtZ)), `t = ${t.toFixed(3)}: z ${pos.getZ(i)} = −zakking × vergroting ${verwachtZ}`);
    }
    ok(pos.getZ(0) > 0 && pos.getZ(pos.count - 1) < 0, "het vrije eind komt omhoog, het midden zakt");
    const label = container.querySelector(".open-fem3d-displacement-label")?.textContent;
    ok(label?.startsWith("u max"), `het label u max (${label})`);
  });

  await test("tekenvlak: alleen druk, de grond laat aan beide vrije einden los", async () => {
    await toon(losModel, { ...basisZicht, groundPressure: true }, OPZIJ, los);
    ok(tekenvlakEl().dataset.openFem3dBeddingLifted === "2", `twee stukken zonder contact (${tekenvlakEl().dataset.openFem3dBeddingLifted})`);
    ok([...container.querySelectorAll(".open-fem3d-bedding-lifted-label")].some((el) => el.textContent === "geen contact"), "\"geen contact\"");
    const waarden = [...container.querySelectorAll(".open-fem3d-diagram-p")].map((el) => getal(el.textContent)).filter(Number.isFinite);
    ok(waarden.every((w) => w >= 0), `geen negatieve gronddruk in de labels (${waarden.join(", ")})`);
  });

  await test("tekenvlak: de band onder beide staven op bedding (laag Opleggingen)", async () => {
    await toon(model, basisZicht, OPZIJ, null);
    const banden: number[] = [];
    renderScene!.traverse((o) => { if (o.userData.openFem3dBeddingBand && (o as THREE.Mesh).isMesh) banden.push(o.userData.id); });
    ok(banden.sort().join() === "1,2", `banden bij staaf 1 en 2 (${banden.join(",")})`);
  });

  await test("rapport: de tabel Staven op bedding met de getallen van de kern", async () => {
    mount(<OpenFem3DReport model={model} result={result} />);
    await wacht(80);
    const sectie = container.querySelector("[data-open-fem3d-report-bedding]");
    ok(sectie?.textContent?.includes("Staven op bedding"), "de kop");
    for (const rij of openFem3DBeddingSummary(model, result)) {
      const tekst = sectie!.querySelector(`[data-open-fem3d-report-bedding-row='${rij.beamId}']`)?.textContent ?? "";
      const r = rij.result!;
      for (const [wat, waarde] of [["w max", nl(r.maxSettlementMm, 2)], ["p max", nl(r.maxPressureKnPerM, 2)],
        ["p/b", nl(r.maxPressureKnPerM2, 1)], ["ΣR", nl(r.totalReactionKn, 2)], ["k", nl(50_000, 0)], ["b", "600"], ["zonder contact", "0 %"]]) {
        ok(tekst.includes(waarde), `staaf ${rij.beamId}: ${wat} ${waarde} in "${tekst}"`);
      }
      ok(Math.abs(r.maxSettlementMm - verwacht.wMaxMm) <= 0.01 * verwacht.wMaxMm, `staaf ${rij.beamId}: w max ${r.maxSettlementMm} mm ≈ analytisch ${verwacht.wMaxMm.toFixed(4)} mm`);
    }
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  const { model, result, losModel, los } = gegevens;
  if (beeld === "gronddruk") {
    await toon(model, { ...basisZicht, groundPressure: true, deformation: true, profiles: false }, OPZIJ, result);
  } else if (beeld === "alleen-druk") {
    await toon(losModel, { ...basisZicht, groundPressure: true, deformation: true, profiles: false }, OPZIJ, los);
  } else if (beeld === "band") {
    await toon(model, { ...DEFAULT_OPEN_FEM_3D_VISIBILITY, grid: false, structuralGrid: false, levelMarks: false, viewCube: false,
      reactions: false, utilization: false, deformation: false, groundPressure: true }, SCHUIN, result);
  } else if (beeld === "rapport") {
    // Alleen de kop van het rapport en de tabel Staven op bedding in beeld.
    const stijl = document.createElement("style");
    stijl.textContent = ".open-fem3d-report-shell section:not([data-open-fem3d-report-bedding]) { display: none; }";
    document.head.appendChild(stijl);
    mount(<div style={{ background: "#fff" }}><OpenFem3DReport model={model} result={result} /></div>);
    await wacht(100);
  }
  await wacht(300);
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });
