/**
 * Browserkant van test-open-fem3d-verlopend-e2e.mjs: de echte uitkomst van de
 * 3D-kern en de echte staaltoets (toetsbrug) voor verlopende staven (issue
 * #73) in het echte tekenvlak en rapport, in een lokale headless browser. De
 * testkant rekent de modellen door de app, de kern en de toetsbrug en zet ze
 * in `window.__VERLOPEND_E2E__`; hier wordt niets gerekend.
 *
 *  - De losse ligger (IPE 500 → IPE 300) in de profielweergave met de
 *    vervormde vorm van de kern: het vervormde volume is aan het begin 500 mm
 *    en aan het eind 300 mm hoog, en zijn as volgt de zakking × de vergroting.
 *  - De momentenlijn My van die ligger: het grootste label is het
 *    inklemmingsmoment van de kern.
 *  - De stalen hal uit de wizard (kolommen en spantliggers verlopend) met de
 *    uitkomst van een combinatie en de unity checks van de toetsbrug.
 *  - Het rapport: een VerloopBlok per verlopende stalen staaf met de
 *    toetsdoorsneden van de toetsbrug.
 *
 * `#beeld=…` toont alleen een beeld voor een schermafbeelding: ligger, hal of
 * rapport.
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
import "../src/themes.css";
import "../src/components/openFem3d/OpenFem3DEditor.css";
import OpenFem3DReport from "../src/components/openFem3d/OpenFem3DReport";
import ThreeFrameCanvas from "../src/components/openFem3d/ThreeFrameCanvas";
import type { OpenFem3DModel } from "../src/components/openFem3d/openFem3dModel";
import type { OpenFem3DSolveResult } from "../src/components/openFem3d/openFem3dSolver";
import type { OpenFem3DSteelChecks } from "../src/components/openFem3d/openFem3dSteelCheck";
import { DEFAULT_OPEN_FEM_3D_VISIBILITY, type OpenFem3DVisibility } from "../src/components/openFem3d/openFem3dVisibility";
import type { OpenFem3DCameraState } from "../src/components/openFem3d/openFem3dViewSets";
import { buildOpenFem3DUtilizations } from "../src/components/openFem3d/openFem3dUtilization";
import { openFem3DMemberDisplacementStations } from "../src/components/openFem3d/openFem3dDisplacement";
import { importeer as importeerEigenDoorsneden } from "../src/lib/profieleditor/eigenDoorsnedenStore";
import type { EigenDoorsnede } from "../src/lib/profieleditor/types";

interface Gegevens {
  ligger: { model: OpenFem3DModel; result: OpenFem3DSolveResult; checks: OpenFem3DSteelChecks; lengteM: number; maKnm: number };
  hal: {
    model: OpenFem3DModel; result: OpenFem3DSolveResult; checks: OpenFem3DSteelChecks;
    eigenDoorsneden: EigenDoorsnede[]; verlopend: number[];
  };
}
const gegevens = (window as unknown as { __VERLOPEND_E2E__: Gegevens }).__VERLOPEND_E2E__;

// De scène waarmee het tekenvlak echt tekent (zoals de andere e2e-browserproeven).
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

function Tekenvlak({ model, zicht, camera, result, checks, breedte = 1200, hoogte = 700 }: {
  model: OpenFem3DModel; zicht: OpenFem3DVisibility; camera?: OpenFem3DCameraState; result: OpenFem3DSolveResult | null;
  checks: OpenFem3DSteelChecks | null; breedte?: number; hoogte?: number;
}) {
  return <div className="open-fem3d-stage" style={{ width: breedte, height: hoogte, flex: "none" }}>
    <ThreeFrameCanvas model={model} onChange={() => {}} tool="select" selection={null} onSelect={() => {}}
      fitToken={0} visibility={zicht} utilizations={buildOpenFem3DUtilizations(checks, null)} result={result}
      cameraRequest={camera ? { state: camera, token: 1 } : undefined} viewRequest={camera ? undefined : { kind: "iso", token: 1 }} />
  </div>;
}
/** Parallel, recht van voren (camera op −y): de ligger langs X van links naar rechts. */
const VOOR: OpenFem3DCameraState = { position: [4, -40, -0.2], target: [4, 0, -0.2], up: [0, 0, 1], orthoHalfHeight: 2.6 };
const basisZicht: OpenFem3DVisibility = {
  ...DEFAULT_OPEN_FEM_3D_VISIBILITY, perspective: false, grid: false, axes: false, structuralGrid: false, levelMarks: false,
  nodeNumbers: false, viewCube: false, loads: false, loadPanels: false, reactions: false, utilization: false, deformation: false,
};
async function toon(element: React.ReactNode, ms = 300) {
  mount(element);
  await wacht(ms);
}
const tekenvlakEl = () => container.querySelector(".open-fem3d-canvas") as HTMLDivElement;
/** Het getal uit een label als "My −88,20 kNm" of "-88.196". */
const getal = (tekst: string | null | undefined) =>
  Number(/([+-]?\d+(?:[.,]\d+)?)/.exec((tekst ?? "").replace("−", "-"))?.[1]?.replace(",", "."));

async function run() {
  await i18next.use(initReactI18next).init({
    lng: "nl", resources: { nl: { common, check, ribbon } }, defaultNS: "common", initImmediate: false,
  });
  // De gelaste tussendoorsneden van de hal (EIGEN:…) staan in de winkel, zoals na Toepassen van de wizard.
  importeerEigenDoorsneden(gegevens.hal.eigenDoorsneden);
  const beeld = new URLSearchParams(location.hash.slice(1)).get("beeld");
  if (beeld) { await toonBeeld(beeld); return; }
  const { ligger, hal } = gegevens;

  await test("ligger: het vervormde volume verloopt van 500 naar 300 mm en volgt de zakking van de kern", async () => {
    await toon(<Tekenvlak model={ligger.model} zicht={{ ...basisZicht, profiles: true, deformation: true }} camera={VOOR}
      result={ligger.result} checks={null} />);
    const schaal = Number(tekenvlakEl().dataset.openFem3dDeformationScale);
    ok(Number.isFinite(schaal) && schaal > 0, `vergroting ${tekenvlakEl().dataset.openFem3dDeformationScale}`);
    ok(tekenvlakEl().dataset.openFem3dDeformedSweeps === "1", `één geveegd profiel (${tekenvlakEl().dataset.openFem3dDeformedSweeps})`);
    let laag: THREE.Mesh | undefined;
    renderScene?.traverse((o) => {
      if (!laag && o.parent?.userData.openFem3dDeformedLayer && (o as THREE.Mesh).isMesh) laag = o as THREE.Mesh;
    });
    ok(laag, "de vervormde laag is getekend");
    const pos = laag!.geometry.getAttribute("position");
    // De vervormde laag tekent 24 intervallen (DEFORMED_STATION_INTERVALS). De
    // ringen staan loodrecht op de vervormde as en kantelen met de (vergrote)
    // draaiing; elk hoekpunt hoort bij de ring met het dichtstbijzijnde
    // asstation (ringen liggen L/24 = 0,33 m uit elkaar, een hoekpunt ligt
    // hoogstens h/2 = 0,25 m van zijn as). Het midden van een ring is het
    // punt op de as, zijn hoogte de afstand in het vlak van de ring (de
    // doorsnede is symmetrisch). Hoekpunten zijn float32: grens 1e-5 m.
    const stations = openFem3DMemberDisplacementStations(ligger.model, ligger.model.beams[0], ligger.result, 24);
    const as = stations.map((st) => ({ x: st.t * ligger.lengteM + st.ux * schaal, z: st.uz * schaal }));
    const groepen: { x: number; z: number }[][] = as.map(() => []);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let beste = 0;
      as.forEach((c, j) => { if ((x - c.x) ** 2 + (z - c.z) ** 2 < (x - as[beste].x) ** 2 + (z - as[beste].z) ** 2) beste = j; });
      groepen[beste].push({ x, z });
    }
    const ringen = groepen.map((groep) => {
      const xs = groep.map((q) => q.x), zs = groep.map((q) => q.z);
      const xc = (Math.min(...xs) + Math.max(...xs)) / 2, zc = (Math.min(...zs) + Math.max(...zs)) / 2;
      const zl = groep.map((q) => Math.sign(q.z - zc) * Math.hypot(q.x - xc, q.z - zc));
      return { punten: groep.length, x: xc, z: zc, hoogte: Math.max(...zl) - Math.min(...zl) };
    });
    ok(ringen.every((r) => r.punten >= 12), `elk station een ring (${ringen.map((r) => r.punten).join(", ")} hoekpunten)`);
    ok(Math.abs(ringen[0].hoogte - 0.5) < 1e-5 && Math.abs(ringen[ringen.length - 1].hoogte - 0.3) < 1e-5,
      `vervormd: ${ringen[0].hoogte.toFixed(6)} m aan het begin (IPE 500), ${ringen[ringen.length - 1].hoogte.toFixed(6)} m aan het eind (IPE 300)`);
    let gecontroleerd = 0;
    stations.forEach((station, i) => {
      const ring = ringen[i];
      // As: de verplaatsing van de app (de momentenlijn van de kern, M/EI per deel) × de vergroting.
      ok(Math.abs(ring.x - (station.t * ligger.lengteM + station.ux * schaal)) < 1e-5, `ring ${i}: x ${ring.x}`);
      ok(Math.abs(ring.z - station.uz * schaal) <= 1e-5, `ring ${i}: as op z = ${ring.z}, zakking × vergroting ${station.uz * schaal}`);
      // Hoogte lineair van 500 naar 300 mm.
      ok(Math.abs(ring.hoogte - (0.5 - 0.2 * station.t)) < 1e-5, `ring ${i}: hoogte ${ring.hoogte} m, verwacht ${0.5 - 0.2 * station.t}`);
      gecontroleerd++;
    });
    const midden = ringen[Math.round(ringen.length / 2)];
    ok(midden.z < -0.01, `het veld zakt zichtbaar (as op ${midden.z.toFixed(3)} m bij x = ${midden.x.toFixed(2)} m)`);
    ok(gecontroleerd === 25, `ringen vergeleken: ${gecontroleerd}`);
  });

  await test("ligger: de momentenlijn My toont het inklemmingsmoment van de kern", async () => {
    await toon(<Tekenvlak model={ligger.model} zicht={{ ...basisZicht, momentY: true }} camera={VOOR} result={ligger.result} checks={null} />);
    ok(tekenvlakEl().dataset.openFem3dResultDiagrams === "1", `één momentenlijn (${tekenvlakEl().dataset.openFem3dResultDiagrams})`);
    const labels = [...container.querySelectorAll(".open-fem3d-diagram-peak-label, .open-fem3d-diagram-label")].map((el) => el.textContent ?? "");
    const waarden = labels.map(getal).filter(Number.isFinite);
    ok(waarden.length > 0, `labels: ${labels.join(" | ")}`);
    const grootste = Math.max(...waarden.map(Math.abs));
    // Labels tonen 1 à 2 decimalen: afronding ≤ 0,05 kNm.
    ok(Math.abs(grootste - Math.abs(ligger.maKnm)) <= 0.051, `grootste label ${grootste} = |M_A| van de kern ${Math.abs(ligger.maKnm).toFixed(3)} kNm (${labels.join(" | ")})`);
  });

  await test("hal: profielen, vervormde vorm en unity checks van de toetsbrug; elke staaf een geveegd profiel", async () => {
    await toon(<Tekenvlak model={hal.model} zicht={{ ...basisZicht, profiles: true, deformation: true, utilization: true }}
      result={hal.result} checks={hal.checks} />, 600);
    ok(Number(tekenvlakEl().dataset.openFem3dDeformedSweeps) === hal.model.beams.length,
      `geveegde profielen ${tekenvlakEl().dataset.openFem3dDeformedSweeps} van ${hal.model.beams.length} staven (ook de EIGEN-tussendoorsneden)`);
    const ucLabels = [...container.querySelectorAll(".open-fem3d-utilization-label")].map((el) => el.textContent ?? "");
    ok(ucLabels.length > 0, "unity-checklabels op het tekenvlak");
  });

  await test("rapport: een VerloopBlok per verlopende stalen staaf, met de toetsdoorsneden van de toetsbrug", async () => {
    await toon(<OpenFem3DReport model={hal.model} result={hal.result} checks={hal.checks} />, 150);
    const blokken = [...container.querySelectorAll<HTMLElement>("[data-open-fem3d-verloop]")];
    ok(blokken.length === hal.verlopend.length, `${blokken.length} blokken voor ${hal.verlopend.length} verlopende staven`);
    const ids = blokken.map((b) => Number(b.dataset.openFem3dVerloop)).sort((a, b) => a - b);
    ok(JSON.stringify(ids) === JSON.stringify([...hal.verlopend].sort((a, b) => a - b)), `de staven: ${ids.join(", ")}`);
    for (const blok of blokken) {
      const uitslag = hal.checks.results.find((r) => r.beam_id === Number(blok.dataset.openFem3dVerloop))!;
      const rijen = blok.querySelectorAll("tbody tr").length;
      ok(rijen >= uitslag.verloop!.toetsdoorsneden.length, `staaf ${uitslag.beam_id}: ${rijen} rijen voor ${uitslag.verloop!.toetsdoorsneden.length} toetsdoorsneden`);
      ok(blok.textContent?.includes("→"), `staaf ${uitslag.beam_id}: de kop noemt het verloop`);
    }
    const staven = container.textContent ?? "";
    ok(staven.includes("HEA 300 → HEA 500"), "de staventabel noemt het verloop van de kolom");
  });

  await test("rapport: de losse ligger met het VerloopBlok en het maatgevende punt", async () => {
    await toon(<OpenFem3DReport model={ligger.model} result={ligger.result} checks={ligger.checks} />, 150);
    const blok = container.querySelector<HTMLElement>("[data-open-fem3d-verloop='1']");
    ok(blok, "het VerloopBlok van staaf 1");
    ok(blok!.textContent?.includes("IPE 500 → IPE 300"), `kop: ${blok!.querySelector("h3")?.textContent}`);
    ok(blok!.querySelector("tr.rpt-verloop-maatgevend"), "het maatgevende punt is gemarkeerd");
    // Zoals in 2D (#30): de toelichting bij de stabiliteitsdoorsnede breekt af
    // binnen de pagina; geen tabel en geen cel steekt voorbij de tekstbreedte
    // (de rechterkant van de pagina min haar binnenmarge).
    const paginaEl = container.querySelector<HTMLElement>(".open-fem3d-report-page")!;
    const rand = paginaEl.getBoundingClientRect().right - parseFloat(getComputedStyle(paginaEl).paddingRight);
    const buiten = [...blok!.querySelectorAll("table, th, td")].filter((el) => el.getBoundingClientRect().right > rand + 0.5);
    ok(blok!.querySelectorAll("td.rpt-verloop-reden").length > 0, "de tabel Doorsnede voor de stabiliteitstoetsen staat er");
    ok(buiten.length === 0, `${buiten.length} cellen voorbij de tekstbreedte (${rand.toFixed(0)} px): ${buiten.slice(0, 3)
      .map((el) => `${el.textContent?.slice(0, 40)} tot ${el.getBoundingClientRect().right.toFixed(0)}`).join(" | ")}`);
  });
}

/** Beelden voor de schermafbeeldingen (geen proeven). */
async function toonBeeld(beeld: string) {
  const { ligger, hal } = gegevens;
  if (beeld === "ligger") {
    await toon(<Tekenvlak model={ligger.model} zicht={{ ...basisZicht, profiles: true, deformation: true, momentY: true, utilization: true }}
      camera={VOOR} result={ligger.result} checks={ligger.checks} />, 400);
  } else if (beeld === "hal") {
    await toon(<Tekenvlak model={hal.model} zicht={{ ...basisZicht, profiles: true, deformation: true, utilization: true, supports: true }}
      result={hal.result} checks={hal.checks} />, 800);
  } else if (beeld === "rapport") {
    // Alleen de toetsing met het VerloopBlok van de ligger in beeld.
    const stijl = document.createElement("style");
    stijl.textContent = ".open-fem3d-report-shell section:not(:has([data-open-fem3d-verloop])) { display: none; }";
    document.head.appendChild(stijl);
    await toon(<div style={{ background: "#fff" }}><OpenFem3DReport model={ligger.model} result={ligger.result} checks={ligger.checks} /></div>, 200);
  }
  await wacht(300);
}

run()
  .then(() => { const el = document.getElementById("uitslag"); if (el && !el.textContent) el.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { const el = document.getElementById("uitslag"); if (el) el.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });
